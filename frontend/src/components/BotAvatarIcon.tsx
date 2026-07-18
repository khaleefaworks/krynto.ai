// Shared bot/AI avatar mascot — matches the widget's BOT_AVATAR_SVG so the
// same icon shows up on every "who's handling this" surface across the app.
// currentColor + text-black/dark:text-white so it's black in light mode,
// white in dark mode, wherever it's dropped in.
// No extra stroke boost here (unlike the widget's copy) — this renders as
// small as 14px in the badge overlays, where the same stroke weight muddies
// the fine details (eye rings especially) instead of just looking bolder.
export default function BotAvatarIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 48 48"
            xmlns="http://www.w3.org/2000/svg"
            className={`text-black dark:text-white ${className || ''}`}
            fill="currentColor"
            aria-hidden="true"
        >
            <path d="m21 25c0-1.654-1.346-3-3-3s-3 1.346-3 3 1.346 3 3 3 3-1.346 3-3zm-3 1c-.551 0-1-.448-1-1s.449-1 1-1 1 .449 1 1-.449 1-1 1z" />
            <path d="m30 22c-1.654 0-3 1.346-3 3s1.346 3 3 3 3-1.346 3-3-1.346-3-3-3zm0 4c-.551 0-1-.448-1-1s.449-1 1-1 1 .449 1 1-.449 1-1 1z" />
            <path d="m28.543 33.91c-2.815 1.447-6.271 1.447-9.086 0-.492-.253-1.094-.059-1.347.433s-.059 1.094.433 1.347c1.669.857 3.556 1.311 5.457 1.311s3.788-.453 5.457-1.311c.491-.253.685-.855.433-1.347s-.855-.686-1.347-.433z" />
            <path d="m45 22h-3v-3c0-2.757-2.243-5-5-5h-12v-4.142c1.72-.447 3-2 3-3.858 0-2.206-1.794-4-4-4s-4 1.794-4 4c0 1.858 1.28 3.411 3 3.858v4.142h-12c-2.757 0-5 2.243-5 5v3h-3c-1.654 0-3 1.346-3 3v9c0 1.654 1.346 3 3 3h3v3c0 2.757 2.243 5 5 5h26c2.757 0 5-2.243 5-5v-3h3c1.654 0 3-1.346 3-3v-9c0-1.654-1.346-3-3-3zm-23-16c0-1.103.897-2 2-2s2 .897 2 2-.897 2-2 2-2-.897-2-2zm-19 29c-.551 0-1-.448-1-1v-9c0-.551.449-1 1-1h3v11zm37 5c0 1.654-1.346 3-3 3h-26c-1.654 0-3-1.346-3-3v-21c0-1.654 1.346-3 3-3h26c1.654 0 3 1.346 3 3zm6-6c0 .552-.449 1-1 1h-3v-11h3c.551 0 1 .449 1 1z" />
        </svg>
    )
}
