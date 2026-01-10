import { google } from "googleapis";
import path from "path";

// Initialize Google Drive API client
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

// Check for env var credentials first (preferred for production)
let credentials;
try {
    credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
        ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
        : undefined;
} catch (error) {
    console.error("Error parsing GOOGLE_SERVICE_ACCOUNT_JSON environment variable");
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
}

const auth = new google.auth.GoogleAuth({
    credentials,
    keyFile: !credentials ? path.join(process.cwd(), "service-account.json") : undefined,
    scopes: SCOPES,
});

const drive = google.drive({ version: "v3", auth });

// Cache for folder file listings
const FILE_CACHE = new Map<string, { time: number; files: Map<string, string> }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Get all files in a Google Drive folder
 * Returns a map of filename -> file ID
 */
async function listFolderFiles(folderId: string): Promise<Map<string, string>> {
    const cached = FILE_CACHE.get(folderId);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.files;
    }

    const fileMap = new Map<string, string>();

    try {
        let pageToken: string | undefined;

        do {
            const res = await drive.files.list({
                q: `'${folderId}' in parents and trashed = false`,
                fields: "nextPageToken, files(id, name)",
                pageSize: 1000,
                pageToken,
            });

            const files = res.data.files || [];
            for (const file of files) {
                if (file.name && file.id) {
                    fileMap.set(file.name.toLowerCase(), file.id);
                }
            }

            pageToken = res.data.nextPageToken || undefined;
        } while (pageToken);

        FILE_CACHE.set(folderId, { time: Date.now(), files: fileMap });
        console.log(`[listFolderFiles] Cached ${fileMap.size} files from folder ${folderId}`);
    } catch (error) {
        console.error("[listFolderFiles] Error:", error);
    }

    return fileMap;
}

// PFP folder ID extracted from the provided URL
const PFP_FOLDER_ID = "1GLvOO6maCyG28KtVu_Rh1z5HrYOHBWBD";

/**
 * Get the profile picture URL for a member
 * Returns the Google Drive direct URL or default image URL
 */
export async function getProfilePictureUrl(memberId: string | number): Promise<string> {
    const filename = `${memberId}.jpg`.toLowerCase();
    const defaultFilename = "default.jpg";

    const files = await listFolderFiles(PFP_FOLDER_ID);

    // Try jpg first, then png as fallback
    const fileId = files.get(filename) || files.get(`${memberId}.png`.toLowerCase()) || files.get(defaultFilename) || files.get("default.png");

    if (fileId) {
        // Use lh3.googleusercontent.com direct URL which works better for shared files
        return `https://lh3.googleusercontent.com/d/${fileId}=w200`;
    }

    // Ultimate fallback - a placeholder
    return "/placeholder-avatar.png";
}

/**
 * Check if a specific profile picture exists
 */
export async function hasProfilePicture(memberId: string | number): Promise<boolean> {
    const files = await listFolderFiles(PFP_FOLDER_ID);
    return files.has(`${memberId}.jpg`.toLowerCase()) || files.has(`${memberId}.png`.toLowerCase());
}

// Cache for file modification times (lightweight, separate from data cache)
const MOD_TIME_CACHE = new Map<string, { time: number; modifiedTime: string }>();
const MOD_TIME_CACHE_TTL = 30 * 1000; // 30 seconds - short TTL for the mod time check itself

/**
 * Get the modification time of a Google Drive file (spreadsheet)
 * This is a lightweight call that returns quickly
 * @param fileId - The Google Drive file ID (extracted from sheet URL)
 * @returns ISO timestamp string of last modification, or null if error
 */
export async function getFileModifiedTime(fileId: string): Promise<string | null> {
    // Short-circuit: if we checked very recently, don't hit API again
    const cached = MOD_TIME_CACHE.get(fileId);
    if (cached && Date.now() - cached.time < MOD_TIME_CACHE_TTL) {
        return cached.modifiedTime;
    }

    try {
        const res = await drive.files.get({
            fileId,
            fields: "modifiedTime",
        });

        const modifiedTime = res.data.modifiedTime || null;
        if (modifiedTime) {
            MOD_TIME_CACHE.set(fileId, { time: Date.now(), modifiedTime });
        }
        return modifiedTime;
    } catch (error: any) {
        console.error(`[getFileModifiedTime] Error for ${fileId}:`, error?.message || error);
        return null;
    }
}

/**
 * Extract Google Drive/Sheets file ID from a URL
 */
export function extractFileId(url: string): string | null {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}
