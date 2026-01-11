import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ memberId: string }> }
) {
    try {
        const { memberId } = await params;

        if (!memberId) {
            return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
        }

        const pfpDir = path.join(process.cwd(), "public", "pfp");

        // Try jpg first, then png
        const jpgPath = path.join(pfpDir, `${memberId}.jpg`);
        const pngPath = path.join(pfpDir, `${memberId}.png`);

        if (fs.existsSync(jpgPath)) {
            return NextResponse.json({ url: `/pfp/${memberId}.jpg` });
        }

        if (fs.existsSync(pngPath)) {
            return NextResponse.json({ url: `/pfp/${memberId}.png` });
        }

        // Check for default
        const defaultJpg = path.join(pfpDir, "default.jpg");
        const defaultPng = path.join(pfpDir, "default.png");

        if (fs.existsSync(defaultJpg)) {
            return NextResponse.json({ url: `/pfp/default.jpg` });
        }

        if (fs.existsSync(defaultPng)) {
            return NextResponse.json({ url: `/pfp/default.png` });
        }

        // No image found
        return NextResponse.json({ url: null });
    } catch (error) {
        console.error("[pfp] Error:", error);
        return NextResponse.json({ error: "Failed to get profile picture" }, { status: 500 });
    }
}
