from fastapi.testclient import TestClient

from app.main import app
from app.schemas.interview import (
    AdaptationPreviewRequest,
    InterviewConfig,
)
from app.services.adaptation import (
    adjust_difficulty,
    reviewer_instruction,
)


client = TestClient(app)


def test_options_has_reviewer_types():
    response = client.get("/api/interviews/options")

    assert response.status_code == 200

    values = {
        item["value"]
        for item in response.json()["reviewer_styles"]
    }

    assert values == {
        "friendly",
        "neutral",
        "pressure"
    }


def test_strict_configuration_validation():
    response = client.post(
        "/api/interviews/adaptation/preview",
        json={
            "config": {
                "adaptation_level": 8
            },
            "current_difficulty": 3
        }
    )

    assert response.status_code == 422


def test_user_feedback_is_prioritized_even_when_auto_off():
    data = AdaptationPreviewRequest(
        config=InterviewConfig(adaptation_level=0),
        current_difficulty=3,
        answer_score=99,
        user_feedback="too_hard"
    )

    result = adjust_difficulty(data)

    assert result.next_difficulty == 2
    assert result.changed is True


def test_standard_requires_two_good_answers():
    request = {
        "config": {
            "adaptation_level": 2
        },
        "current_difficulty": 3,
        "answer_score": 90
    }

    first = client.post(
        "/api/interviews/adaptation/preview",
        json=request
    ).json()

    assert first["next_difficulty"] == 3
    assert first["positive_streak"] == 1

    request["positive_streak"] = first["positive_streak"]

    second = client.post(
        "/api/interviews/adaptation/preview",
        json=request
    ).json()

    assert second["next_difficulty"] == 4
    assert second["positive_streak"] == 0


def test_no_score_means_no_automatic_changes():
    result = adjust_difficulty(
        AdaptationPreviewRequest(
            config=InterviewConfig(),
            current_difficulty=3
        )
    )

    assert result.next_difficulty == 3


def test_difficulty_stays_within_bounds():
    result = adjust_difficulty(
        AdaptationPreviewRequest(
            config=InterviewConfig(),
            current_difficulty=5,
            user_feedback="too_easy"
        )
    )

    assert result.next_difficulty == 5


def test_pressure_prompt_has_safety_boundary():
    assert "不得辱骂" in reviewer_instruction("pressure")