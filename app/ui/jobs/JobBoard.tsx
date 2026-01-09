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

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
  };
}

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
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ height: 100, background: "rgba(0,0,0,0.04)", borderRadius: 14 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ height: 100, background: "rgba(0,0,0,0.04)", borderRadius: 14 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...card(), background: "rgba(255,0,0,0.05)", borderColor: "rgba(255,0,0,0.3)" }}>
        <p style={{ color: "#c00" }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {activeJob && (
        <ActiveJob job={activeJob} onQuit={fetchJobs} />
      )}

      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Available Jobs</h2>

        {jobs.length === 0 ? (
          <div style={{ ...card(), textAlign: "center" }}>
            <p style={{ opacity: 0.5 }}>No jobs available at the moment</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
