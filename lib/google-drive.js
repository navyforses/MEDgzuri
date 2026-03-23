/**
 * Google Drive upload helper for medical documents.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — full JSON key (stringified) for a GCP service account
 *   GOOGLE_DRIVE_FOLDER_ID      — ID of the shared Drive folder where files are uploaded
 *
 * The service account must have Editor access to the target folder.
 */

const { google } = require('googleapis');
const { Readable } = require('stream');

let _drive = null;

function getDriveClient() {
    if (_drive) return _drive;

    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;

    const credentials = JSON.parse(raw);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    _drive = google.drive({ version: 'v3', auth });
    return _drive;
}

/**
 * Upload a single file buffer to Google Drive.
 * Returns { id, name, webViewLink } or null on failure.
 */
async function uploadFile(buffer, fileName, mimeType) {
    const drive = getDriveClient();
    if (!drive) return null;

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return null;

    const fileMetadata = {
        name: fileName,
        parents: [folderId],
    };

    const media = {
        mimeType: mimeType || 'application/octet-stream',
        body: Readable.from(buffer),
    };

    const response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, webViewLink',
    });

    return response.data;
}

/**
 * Create a sub-folder inside the main Drive folder for a specific lead.
 * Returns the folder ID.
 */
async function createLeadFolder(leadName, timestamp) {
    const drive = getDriveClient();
    if (!drive) return null;

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return null;

    const folderName = `${leadName || 'lead'} — ${timestamp || new Date().toISOString().slice(0, 10)}`;

    const response = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [folderId],
        },
        fields: 'id',
    });

    return response.data.id;
}

/**
 * Upload multiple file buffers to a lead-specific sub-folder.
 * Returns array of { id, name, webViewLink }.
 */
async function uploadLeadDocuments(files, leadName) {
    const drive = getDriveClient();
    if (!drive || files.length === 0) return [];

    // Create a sub-folder for this lead
    const subFolderId = await createLeadFolder(leadName);
    const parentFolder = subFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

    const results = [];
    for (const file of files) {
        const fileMetadata = {
            name: file.name,
            parents: [parentFolder],
        };

        const media = {
            mimeType: file.mimeType || 'application/octet-stream',
            body: Readable.from(file.buffer),
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media,
            fields: 'id, name, webViewLink',
        });

        results.push(response.data);
    }

    return results;
}

module.exports = { uploadFile, uploadLeadDocuments, createLeadFolder };
