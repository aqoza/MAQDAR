"""Synthetic data generator for MAQDAR.

Generates import-format CSV bundles (locations, items, supersessions, suppliers, supplier items and
daily demand history) for the Gulf service-parts network described in docs/synthetic-data.md, and
loads them into the local Supabase stack.
"""

GENERATOR_VERSION = "1.0.0"
