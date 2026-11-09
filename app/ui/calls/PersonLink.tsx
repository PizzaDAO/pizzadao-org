import Link from "next/link";

/**
 * A member's name, linked to their app profile when we know their member id (plain text otherwise).
 * Never pass a memberId for an anonymous asker.
 */
export default function PersonLink({ name, memberId, className }: { name: string; memberId?: string | null; className?: string }) {
    if (!memberId) return <span className={className}>{name}</span>;
    return (
        <Link href={`/profile/${encodeURIComponent(memberId)}`} className={`underline underline-offset-2 hover:text-tomato-readable ${className ?? ""}`}>
            {name}
        </Link>
    );
}
