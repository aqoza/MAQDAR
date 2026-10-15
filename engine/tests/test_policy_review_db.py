"""Independent sessions verify proposal and reviewer races, plus live-role enforcement."""

import json
from uuid import uuid4

import psycopg
import pytest

from test_tenancy_concurrency import _race

pytestmark = pytest.mark.db
SUBMIT = "select public.policy_override_submit(%s,%s,%s,%s,%s,%s)"
DECIDE = "select public.policy_override_decide(%s,%s,%s,%s,%s)"


@pytest.fixture
def review(dsn):
    org, location, run, policy = (uuid4() for _ in range(4))
    users = [uuid4() for _ in range(4)]
    with psycopg.connect(dsn) as db:
        db.execute(
            "insert into public.organizations(id,slug,name) values(%s,%s,'Review test')",
            (org, f"review-{org}"),
        )
        for user, role in zip(
            users, ["planner", "approver", "admin", "owner"], strict=True
        ):
            db.execute(
                "insert into auth.users(id,email) values(%s,%s)",
                (user, f"review-{user}@test.local"),
            )
            db.execute(
                "insert into public.memberships(organization_id,user_id,role) values(%s,%s,%s)",
                (org, user, role),
            )
        db.execute(
            "insert into public.locations(id,organization_id,code,name_en,location_type,country_code,timezone) values(%s,%s,'L','Location','branch','SA','Asia/Riyadh')",
            (location, org),
        )
        db.execute(
            "insert into public.planning_runs(id,organization_id,location_id,request_id,from_date,to_date,kind,status,options,result,finished_at) values(%s,%s,%s,%s,'2026-07-01','2026-10-01','policy','succeeded','{}','{}',now())",
            (run, org, location, uuid4()),
        )
        db.execute(
            "insert into public.inventory_policies(id,organization_id,run_id,location_id,forecast_id,item_id,item_code,status,summary,evidence) values(%s,%s,%s,%s,%s,%s,'ITEM','available','{}','{}')",
            (policy, org, run, location, uuid4(), uuid4()),
        )
    yield dsn, org, policy, users
    with psycopg.connect(dsn) as db:
        db.execute("delete from public.organizations where id=%s", (org,))
        db.execute("delete from auth.users where id=any(%s)", (users,))
        db.execute("delete from public.audit_log where organization_id=%s", (org,))


def session(fixture, user):
    db = psycopg.connect(fixture[0])
    db.execute("set local role authenticated")
    db.execute(
        "select set_config('request.jwt.claims',%s,true)",
        (
            json.dumps(
                dict(sub=str(user), org_id=str(fixture[1]), role="authenticated")
            ),
        ),
    )
    return db


def propose(fixture, user=None, request=None):
    with session(fixture, user or fixture[3][0]) as db:
        return db.execute(
            SUBMIT,
            (
                fixture[1],
                fixture[2],
                request or uuid4(),
                "5.001",
                "10.002",
                "Planning reason",
            ),
        ).fetchone()[0]


def test_parallel_proposals_have_one_pending_record(review):
    with (
        session(review, review[3][0]) as first,
        session(review, review[3][3]) as second,
    ):
        common = (review[1], review[2])
        waiter = _race(
            first,
            second,
            SUBMIT,
            (*common, uuid4(), "5", "10", "First"),
            (*common, uuid4(), "6", "12", "Second"),
        )
        assert waiter.sqlstate == "MQ409"
    with psycopg.connect(review[0]) as db:
        assert (
            db.execute(
                "select count(*) from public.policy_overrides where policy_id=%s",
                (review[2],),
            ).fetchone()[0]
            == 1
        )


def test_competing_reviewers_cannot_replace_the_winning_decision(review):
    proposal = propose(review)
    with (
        session(review, review[3][1]) as first,
        session(review, review[3][2]) as second,
    ):
        waiter = _race(
            first,
            second,
            DECIDE,
            (review[1], proposal, uuid4(), "approved", "First"),
            (review[1], proposal, uuid4(), "rejected", "Second"),
        )
        assert waiter.sqlstate == "MQ409"
    with psycopg.connect(review[0]) as db:
        row = db.execute(
            "select status,decided_by,decision_reason from public.policy_overrides where id=%s",
            (proposal,),
        ).fetchone()
        assert row == ("approved", review[3][1], "First")
        assert (
            db.execute(
                "select count(*) from public.audit_log where record_id=%s", (proposal,)
            ).fetchone()[0]
            == 2
        )


def test_revoked_reviewer_and_demoted_author_are_checked_live(review):
    proposal = propose(review)
    with psycopg.connect(review[0]) as db:
        db.execute(
            "delete from public.memberships where organization_id=%s and user_id=%s",
            (review[1], review[3][1]),
        )
        db.execute(
            "update public.memberships set role='viewer' where organization_id=%s and user_id=%s",
            (review[1], review[3][0]),
        )
    with session(review, review[3][1]) as db, pytest.raises(psycopg.Error) as error:
        db.execute(
            DECIDE, (review[1], proposal, uuid4(), "approved", "No longer a member")
        )
    assert error.value.sqlstate == "MQ403"
    with session(review, review[3][0]) as db:
        assert (
            db.execute(
                DECIDE, (review[1], proposal, uuid4(), "withdrawn", "Author withdraws")
            ).fetchone()[0]
            == review[2]
        )
    with pytest.raises(psycopg.Error) as error:
        propose(review)
    assert error.value.sqlstate == "MQ403"


def test_terminal_replay_and_unavailable_source_do_not_mutate_history(review):
    request = uuid4()
    proposal = propose(review, request=request)
    with session(review, review[3][2]) as db:
        db.execute(DECIDE, (review[1], proposal, uuid4(), "rejected", "Reviewed"))
    assert propose(review, request=request) == proposal
    with psycopg.connect(review[0]) as db:
        db.execute(
            "update public.inventory_policies set status='calibration_failed' where id=%s",
            (review[2],),
        )
    with pytest.raises(psycopg.Error) as error:
        propose(review)
    assert error.value.sqlstate == "MQ422"
