$ErrorActionPreference = 'Stop'

$baseUrl = 'http://127.0.0.1:8000'

$checks = @(
    @{ Name = 'Health'; Path = '/api/health' },
    @{ Name = 'Resumes'; Path = '/api/resumes' },
    @{ Name = 'Materials'; Path = '/api/materials' },
    @{ Name = 'Statistics'; Path = '/api/interviews/statistics' },
    @{ Name = 'History'; Path = '/api/interviews/history?limit=8&offset=0' }
)

$failed = 0

Write-Host ''
Write-Host '=== Stage 5E API Smoke Test ===' -ForegroundColor Cyan
Write-Host "Backend: $baseUrl"
Write-Host ''

foreach ($check in $checks) {
    $url = $baseUrl + $check.Path

    try {
        $response = Invoke-WebRequest `
            -Uri $url `
            -Method Get `
            -UseBasicParsing `
            -TimeoutSec 15 `
            -ErrorAction Stop

        if ($response.StatusCode -eq 200) {
            Write-Host "[OK] $($check.Name) - HTTP 200" -ForegroundColor Green
        }
        else {
            $failed++
            Write-Host "[FAIL] $($check.Name) - HTTP $($response.StatusCode)" -ForegroundColor Red
        }
    }
    catch {
        $failed++
        Write-Host "[FAIL] $($check.Name)" -ForegroundColor Red
        Write-Host "       $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ''

if ($failed -gt 0) {
    throw "$failed API check(s) failed."
}

Write-Host 'All 5 API checks passed.' -ForegroundColor Green