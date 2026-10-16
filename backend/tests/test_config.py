import pytest

from app.core.config import ConfigError, load_settings

BASE = {"OPENROUTER_API_KEY": "sk-or-test-key", "MODEL_NAME": "google/gemma-4-26b-a4b-it"}
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


def test_paid_model_is_accepted():
    settings = load_settings({**BASE, "ENV": "development", "MODEL_NAME": "google/gemma-4-26b-a4b-it"})
    assert settings.model_name == "google/gemma-4-26b-a4b-it"


def test_free_suffix_is_still_accepted():
    settings = load_settings({**BASE, "ENV": "development", "MODEL_NAME": "google/gemma-4-26b-a4b-it:free"})
    assert settings.model_name == "google/gemma-4-26b-a4b-it:free"


@pytest.mark.parametrize(
    "model_name",
    [
        "google/gemma-4-26b-a4b-it:online",
        "google/gemma-4-26b-a4b-it:nitro",
        "google/gemma-4-26b-a4b-it:floor",
        "Google/Gemma-4-26b-A4b-It",
        "google/gemma 4-26b-a4b-it",
        "gemma-4-26b-a4b-it",
        "openrouter/auto",
        "perplexity/sonar",
        "openai/gpt-5-nano",
        "",
    ],
)
def test_invalid_model_name_is_refused(model_name):
    with pytest.raises(ConfigError, match="MODEL_NAME"):
        load_settings({**BASE, "ENV": "development", "MODEL_NAME": model_name})


def test_model_name_with_surrounding_whitespace_is_still_accepted():
    settings = load_settings({**BASE, "ENV": "development", "MODEL_NAME": "  google/gemma-4-26b-a4b-it  "})
    assert settings.model_name == "google/gemma-4-26b-a4b-it"


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


def test_price_defaults(tmp_path):
    settings = load_settings({**BASE, "ENV": "development", "DATA_DIR": str(tmp_path)})
    assert settings.llm_max_prompt_price == 0.15
    assert settings.llm_max_completion_price == 0.60


def test_price_values_are_read():
    settings = load_settings(
        {**BASE, "ENV": "development", "LLM_MAX_PROMPT_PRICE": "0.11", "LLM_MAX_COMPLETION_PRICE": "0.44"}
    )
    assert settings.llm_max_prompt_price == 0.11
    assert settings.llm_max_completion_price == 0.44


@pytest.mark.parametrize("name", ["LLM_MAX_PROMPT_PRICE", "LLM_MAX_COMPLETION_PRICE"])
@pytest.mark.parametrize("value", ["abc", "0", "-1", "nan", "inf", "1.01", "0.009", "1e-9", "0.00000015"])
def test_invalid_price_is_refused(name, value):
    with pytest.raises(ConfigError, match=name):
        load_settings({**BASE, "ENV": "development", name: value})


@pytest.mark.parametrize("name", ["LLM_MAX_PROMPT_PRICE", "LLM_MAX_COMPLETION_PRICE"])
def test_max_price_boundary_is_accepted(name):
    settings = load_settings({**BASE, "ENV": "development", name: "1.0"})
    assert getattr(settings, name.lower()) == 1.0


@pytest.mark.parametrize("name", ["LLM_MAX_PROMPT_PRICE", "LLM_MAX_COMPLETION_PRICE"])
def test_min_price_boundary_is_accepted(name):
    settings = load_settings({**BASE, "ENV": "development", name: "0.01"})
    assert getattr(settings, name.lower()) == 0.01


@pytest.mark.parametrize("name", ["LLM_MAX_PROMPT_PRICE", "LLM_MAX_COMPLETION_PRICE"])
def test_below_min_price_message_cites_unit(name):
    with pytest.raises(ConfigError, match="USD por milhão de tokens"):
        load_settings({**BASE, "ENV": "development", name: "0.009"})
