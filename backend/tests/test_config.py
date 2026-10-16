import pytest

from app.core.config import ConfigError, load_settings

BASE = {"OPENROUTER_API_KEY": "sk-or-test-key", "MODEL_NAME": "google/gemma-4-26b-a4b-it:free"}
PROD = {"ENV": "production", "GATEWAY_KEY": "g" * 43, "IP_HASH_KEY": "h" * 43}


def test_development_defaults(tmp_path):
    settings = load_settings({**BASE, "ENV": "development", "DATA_DIR": str(tmp_path)})
    assert settings.env == "development"
    assert settings.is_production is False
    assert settings.quota_global_daily == 200
    assert settings.quota_per_ip_daily == 10
    assert settings.llm_per_minute == 15
    assert settings.llm_max_concurrency == 2
    assert settings.cache_ttl_hours == 24
    assert settings.gateway_key == ""
    assert settings.ip_hash_key != ""
    assert settings.data_dir == tmp_path


def test_production_settings():
    settings = load_settings({**BASE, **PROD})
    assert settings.is_production is True
    assert settings.gateway_key == "g" * 43


def test_paid_model_is_refused():
    with pytest.raises(ConfigError, match=":free"):
        load_settings({**BASE, "MODEL_NAME": "google/gemma-4-26b-a4b-it"})


def test_missing_api_key_is_refused():
    with pytest.raises(ConfigError, match="OPENROUTER_API_KEY"):
        load_settings({"MODEL_NAME": BASE["MODEL_NAME"]})


@pytest.mark.parametrize("missing", ["GATEWAY_KEY", "IP_HASH_KEY"])
def test_production_requires_secrets(missing):
    env = {**BASE, **PROD}
    del env[missing]
    with pytest.raises(ConfigError, match=missing):
        load_settings(env)


def test_production_rejects_short_secret():
    with pytest.raises(ConfigError, match="GATEWAY_KEY"):
        load_settings({**BASE, **PROD, "GATEWAY_KEY": "curta"})


@pytest.mark.parametrize("name", ["OPENROUTER_API_KEY", "GATEWAY_KEY", "IP_HASH_KEY"])
def test_example_placeholders_are_refused(name):
    env = {**BASE, **PROD, name: "troque-por-32-bytes-aleatorios-base64url-xxxxxxxxxxxx"}
    with pytest.raises(ConfigError, match=name):
        load_settings(env)


@pytest.mark.parametrize("value", ["0", "-1", "abc"])
def test_limits_must_be_positive_integers(value):
    with pytest.raises(ConfigError, match="QUOTA_GLOBAL_DAILY"):
        load_settings({**BASE, "ENV": "development", "QUOTA_GLOBAL_DAILY": value})


def test_unknown_env_is_refused():
    with pytest.raises(ConfigError, match="ENV"):
        load_settings({**BASE, "ENV": "staging"})


def test_missing_env_defaults_to_production_and_requires_gateway_key():
    with pytest.raises(ConfigError, match="GATEWAY_KEY"):
        load_settings(BASE)
