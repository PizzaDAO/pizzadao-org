"use client";

import React, { useState } from "react";

type ActiveJobProps = {
  job: {
    id: number;
    description: string;
    type: string | null;
  };
  onQuit?: () => void;
};

export function ActiveJob({ job, onQuit }: ActiveJobProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleQuit = async () => {
    if (!confirm("Are you sure you want to quit this job? You won't receive any reward.")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs/quit", {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onQuit?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to quit job");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-gradient-to-r from-green-900/30 to-blue-900/30 border border-green-500/50 rounded-lg">
      <div className="flex justify-between items-start mb-3">
        <h2 className="text-xl font-bold text-green-400">Your Active Job</h2>
        <span className="text-xs font-medium px-2 py-1 bg-green-600/20 text-green-400 rounded">
          {job.type || "General"}
        </span>
      </div>

      <p className="text-lg mb-4">{job.description}</p>

      {error && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-500 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleQuit}
          disabled={loading}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition"
        >
          {loading ? "Quitting..." : "Quit Job"}
        </button>
        <p className="text-sm text-gray-400 self-center">
          Complete this job and submit proof to an admin to receive your reward!
        </p>
      </div>
    </div>
  );
}
