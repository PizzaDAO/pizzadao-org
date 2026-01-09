"use client";

import React, { useState } from "react";

type Job = {
  id: number;
  description: string;
  type: string | null;
  assignees: string[];
};

type JobCardProps = {
  job: Job;
  onAssign?: () => void;
  disabled?: boolean;
};

export function JobCard({ job, onAssign, disabled }: JobCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAssign = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onAssign?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign job");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
      <div className="flex justify-between items-start mb-2">
        <span className="text-xs font-medium px-2 py-1 bg-blue-600/20 text-blue-400 rounded">
          {job.type || "General"}
        </span>
        <span className="text-xs text-gray-500">#{job.id}</span>
      </div>

      <p className="text-sm mb-3">{job.description}</p>

      {job.assignees.length > 0 && (
        <p className="text-xs text-gray-500 mb-3">
          Assigned to {job.assignees.length} user(s)
        </p>
      )}

      {error && (
        <div className="mb-3 p-2 bg-red-900/20 border border-red-500 rounded text-red-400 text-xs">
          {error}
        </div>
      )}

      <button
        onClick={handleAssign}
        disabled={loading || disabled}
        className="w-full px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-medium transition"
      >
        {loading ? "Assigning..." : disabled ? "Finish current job first" : "Take this job"}
      </button>
    </div>
  );
}
