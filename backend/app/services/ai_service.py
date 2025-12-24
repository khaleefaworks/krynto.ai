import asyncio


class AIService:
    async def respond(self, message: str) -> str:
        await asyncio.sleep(0.3)

        return (
            "🤖 Thanks for your message! "
            "A human-like AI response will come here soon."
        )
