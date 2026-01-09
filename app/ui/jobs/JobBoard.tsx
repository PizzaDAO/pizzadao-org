"use client";

import React, { useState, useEffect } from "react";
import { JobCard } from "./JobCard";
import { ActiveJob } from "./ActiveJob";

type Job = {
  id: number;
  description: string;
  type: string | null;
  assignees: string[];
};

type ActiveJobData = {
  id: number;
  description: string;
  type: string | null;
};

export function JobBoard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJob, setActiveJob] = useState<ActiveJobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch jobs");
      setJobs(data.jobs);
      setActiveJob(data.activeJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 bg-gray-700 rounded-lg animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-700 rounded-lg animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-500 rounded-lg">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {activeJob && (
        <ActiveJob job={activeJob} onQuit={fetchJobs} />
      )}

      <div>
        <h2 className="text-xl font-bold mb-4">Available Jobs</h2>

        {jobs.length === 0 ? (
          <div className="p-6 bg-gray-800 rounded-lg text-center">
            <p className="text-gray-400">No jobs available at the moment</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onAssign={fetchJobs}
                disabled={!!activeJob}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
