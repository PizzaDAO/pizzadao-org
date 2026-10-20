"use client";

// Shared flag: the review form has unsaved edits. Hide/restore remounts the form (the row
// changes), so RedactSpeaker asks before that happens.
let dirty = false;
export const setReviewDirty = (v: boolean) => {
    dirty = v;
};
export const isReviewDirty = () => dirty;
