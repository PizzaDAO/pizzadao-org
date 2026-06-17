"use client";

import { useState, useEffect, useRef, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, ImagePlus, Lightbulb, User, Mail } from "lucide-react";

interface SuggestionModalProps {
  open: boolean;
  onClose: () => void;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB (matches /api/suggestions/upload cap)

export default function SuggestionModal({ open, onClose }: SuggestionModalProps) {
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state whenever the modal opens.
  useEffect(() => {
    if (open) {
      setBody("");
      setName("");
      setEmail("");
      setImageFile(null);
      setImagePreview(null);
      setSubmitting(false);
      setError(null);
      setSuccess(false);
    }
  }, [open]);

  // Revoke object URL on change/unmount to avoid leaks.
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    // Allow re-picking the same file later.
    e.target.value = "";
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Please choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("Image must be 5MB or smaller.");
      return;
    }

    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const removeImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSubmit = async () => {
    if (!body.trim()) {
      setError("Please enter a suggestion.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      let imageUrl: string | undefined;
      if (imageFile) {
        const fd = new FormData();
        fd.append("file", imageFile);
        const uploadRes = await fetch("/api/suggestions/upload", {
          method: "POST",
          body: fd,
        });
        if (!uploadRes.ok) {
          const data = await uploadRes.json().catch(() => ({}));
          throw new Error(data.error || "Image upload failed.");
        }
        const uploadData = await uploadRes.json();
        imageUrl = uploadData.url as string;
      }

      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          imageUrl,
          pageUrl: window.location.href,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Something went wrong. Please try again.");
      }
      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#ff393a]/40 focus:border-[#ff393a]";

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white text-gray-900 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:text-gray-900 hover:bg-gray-200 transition-colors"
        >
          <X size={20} />
        </button>

        {success ? (
          <div className="flex flex-col items-center text-center py-6">
            <div className="text-4xl mb-3">🍕</div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Thanks! 🍕 We&apos;ll take a look.
            </h2>
            <p className="text-sm text-gray-600 mb-6">Your suggestion has been sent.</p>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-lg bg-[#ff393a] text-white font-medium hover:bg-[#e62f30] transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              Suggest an improvement
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Spotted something? Share an idea to make the site better.
            </p>

            <div className="space-y-3">
              {/* Body */}
              <div className="relative">
                <Lightbulb
                  size={18}
                  className="absolute left-3 top-3 text-gray-400 pointer-events-none"
                />
                <textarea
                  required
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Share an idea to improve the site…"
                  className={`${inputClass} resize-y`}
                />
              </div>

              {/* Name */}
              <div className="relative">
                <User
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name (optional)"
                  className={inputClass}
                />
              </div>

              {/* Email */}
              <div className="relative">
                <Mail
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (optional, if you'd like a reply)"
                  className={inputClass}
                />
              </div>

              {/* Image picker */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFilePick}
              />
              {imagePreview ? (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview}
                    alt="Selected attachment"
                    className="max-h-32 rounded-lg border border-gray-200 object-cover"
                  />
                  <button
                    type="button"
                    onClick={removeImage}
                    aria-label="Remove image"
                    className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center rounded-full bg-gray-900 text-white hover:bg-black transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <ImagePlus size={18} />
                  Add an image (optional)
                </button>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#ff393a] text-white font-medium hover:bg-[#e62f30] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {submitting && <Loader2 size={18} className="animate-spin" />}
                {submitting ? "Sending…" : "Send suggestion"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
