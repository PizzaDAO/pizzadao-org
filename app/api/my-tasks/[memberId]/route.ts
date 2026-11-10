import { NextResponse } from "next/server";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { fetchMyTasksForCrewOption, type MyTask } from "@/app/lib/my-tasks";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";

/**
 * A member's active tasks and closed counts per crew. Each crew reads through
 * fetchMyTasksForCrewOption: the database once `sheets.source.crewTasks` covers the crew, else its
 * crew sheet (rollback path).
 */
export async function GET(req: Request, { params }: { params: Promise<{ memberId: string }> }) {
    const { memberId } = await params;
    if (!memberId) return NextResponse.json({ error: "No memberId" }, { status: 400 });

    try {
        // Crews list directly (avoids an HTTP fetch, which can be blocked by deployment protection)
        const { crews } = await getCrewMappings();

        const allTasksByCrew: Record<string, MyTask[]> = {};
        const allDoneCounts: Record<string, number> = {};

        await Promise.all(
            crews.map(async (c) => {
                const crewId = String(c.id).toLowerCase();
                const { active, doneCount } = await fetchMyTasksForCrewOption(c, memberId);
                if (active.length > 0) allTasksByCrew[crewId] = active;
                if (doneCount > 0) allDoneCounts[crewId] = doneCount;
            })
        );

        return NextResponse.json({
            memberId,
            tasksByCrew: allTasksByCrew,
            doneCountsByCrew: allDoneCounts,
            debug: {},
        });
    } catch (err: any) {
        return internalError(err, "my-tasks", "Failed to load tasks");
    }
}
