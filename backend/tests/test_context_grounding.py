from app.mind.context import build_system_prompt
from app.models.session import Register


def test_shared_grounding_preserves_uncertainty_and_speaker_identity():
    prompt = build_system_prompt(Register.WORKPLACE_POLITE, "Synthetic lab meeting")
    assert "Preserve negation, uncertainty" in prompt
    assert "Do not invent speaker names" in prompt
    assert "ChibaTech" in prompt
    assert "Synthetic lab meeting" in prompt
    assert "best-guess display names" not in prompt
