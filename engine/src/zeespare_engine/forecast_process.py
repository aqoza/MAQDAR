"""Isolate numerical libraries so a stalled fit cannot outlive the expanded lease."""
import multiprocessing


def _run(sender, task):
    try:
        from threadpoolctl import threadpool_limits
        if task.get('method') == 'policy-v1':
            from zeespare_engine.inventory_policy import calculate as forecast
        elif task.get('method') == 'regional-v1':
            from zeespare_engine.regional_forecasting import forecast
        elif task.get('method') == 'driver-v1':
            from zeespare_engine.driver_forecasting import forecast
        elif task.get('method') == 'multi-driver-v1':
            from zeespare_engine.multi_driver_forecasting import forecast
        else:
            from zeespare_engine.expanded_forecasting import forecast
        with threadpool_limits(limits=1):
            sender.send(forecast(task))
    except Exception:
        # The parent records the generic retry code, never library text or source data.
        sender.send(None)
    finally:
        sender.close()


def compute(task: dict, timeout: float = 720) -> list[dict]:
    context = multiprocessing.get_context('spawn')
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_run, args=(sender, task), daemon=True)
    try:
        process.start()
        sender.close()
        if not receiver.poll(timeout):
            raise ValueError('Forecast computation timed out')
        result = receiver.recv()
        if not isinstance(result, list):
            raise ValueError('Forecast computation failed')
        return result
    except EOFError as error:
        raise ValueError('Forecast process exited') from error
    finally:
        receiver.close()
        sender.close()
        if process.pid is not None:
            process.join(timeout=1)
            if process.is_alive():
                process.terminate()
                process.join()
