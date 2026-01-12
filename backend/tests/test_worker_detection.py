from app.core.worker_detection import detect_configured_worker_count


def test_detect_worker_count_from_web_concurrency():
    assert detect_configured_worker_count({"WEB_CONCURRENCY": "4"}) == 4


def test_detect_worker_count_from_gunicorn_cmd_args_long_flag():
    assert detect_configured_worker_count({"GUNICORN_CMD_ARGS": "--workers 3"}) == 3


def test_detect_worker_count_from_gunicorn_cmd_args_equals_form():
    assert detect_configured_worker_count({"GUNICORN_CMD_ARGS": "--workers=2"}) == 2


def test_detect_worker_count_from_gunicorn_cmd_args_short_flag():
    assert detect_configured_worker_count({"GUNICORN_CMD_ARGS": "-w 5"}) == 5
