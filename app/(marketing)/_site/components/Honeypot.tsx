"use client";

/** A field real visitors never see or fill; the API silently drops a submission where it has a value. */
const Honeypot = () => (
  <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
    <label>
      Website
      <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
    </label>
  </div>
);

export default Honeypot;
