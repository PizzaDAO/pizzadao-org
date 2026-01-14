import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET() {
    const envVar = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    let authStatus = {
        hasEnvVar: !!envVar,
        envVarLength: envVar?.length,
        parsed: false,
        error: null as any,
        projectId: null,
        clientEmail: null,
        privateKeyValid: false,
        privateKeyHasNewlines: false
    };

    if (envVar) {
        try {
            const creds = JSON.parse(envVar);
            authStatus.parsed = true;
            authStatus.projectId = creds.project_id;
            authStatus.clientEmail = creds.client_email;

            if (creds.private_key) {
                authStatus.privateKeyValid = true;
                // Check if it contains actual newlines
                authStatus.privateKeyHasNewlines = creds.private_key.includes('\n');
            }
        } catch (e: unknown) {
            authStatus.error = (e as any)?.message || String(e);
        }
    }

    return NextResponse.json(authStatus);
}
