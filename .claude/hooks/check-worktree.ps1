# Hook script to block direct edits in main repo (must use worktree)
# Reads tool input from stdin as JSON, checks if file is in protected directories

# Read JSON input from stdin
$jsonInput = $input | Out-String
$toolInput = $null

try {
    $toolInput = $jsonInput | ConvertFrom-Json
} catch {
    # If we can't parse JSON, allow the action
    exit 0
}

# Get file path from tool input
$filePath = $toolInput.file_path
if (-not $filePath) {
    exit 0  # No file path, allow
}

# Check if file is in protected directories
$protectedPatterns = @("\\app\\", "\\components\\", "\\lib\\", "\\prisma\\", "/app/", "/components/", "/lib/", "/prisma/")
$isProtected = $false

foreach ($pattern in $protectedPatterns) {
    if ($filePath -like "*$pattern*") {
        $isProtected = $true
        break
    }
}

if (-not $isProtected) {
    exit 0  # Not a protected file, allow
}

# Check if we're in the main repo (not a worktree)
# Main repo ends with just "onboarding", worktrees are "onboarding-{task-id}"
$currentDir = (Get-Location).Path
if ($currentDir -match "\\onboarding$" -or $currentDir -match "/onboarding$") {
    Write-Host ""
    Write-Host "BLOCKED: Cannot edit implementation files directly in main repo."
    Write-Host ""
    Write-Host "You MUST use a worktree + implementation agent:"
    Write-Host "  1. Dispatch a background agent with subagent_type='general-purpose'"
    Write-Host "  2. Agent creates worktree: git worktree add ../onboarding-{task-id} -b feature/{task-id}"
    Write-Host "  3. Agent implements changes in the worktree"
    Write-Host "  4. Agent creates draft PR for Vercel preview"
    Write-Host ""
    Write-Host "See CLAUDE.md for the full workflow."
    Write-Host ""
    exit 1
}

# We're in a worktree, allow the edit
exit 0
