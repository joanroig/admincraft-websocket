# PowerShell script to test the start of the admincraft-websocket container

# Configuration variables
$SECRET_KEY = "your_secret_key_here" # Change this to a secure value
$USE_SSL = $false
$MC_NAME = "minecraft"

# Convert boolean to string for environment variable
$USE_SSL_STRING = if ($USE_SSL) { "true" } else { "false" }

Write-Host "Building Docker image..." -ForegroundColor Cyan
docker build -t admincraft-websocket .

Write-Host "Starting admincraft-websocket container..." -ForegroundColor Green
docker run -d --name admincraft-websocket `
    -p 8080:8080 `
    -e SECRET_KEY=$SECRET_KEY `
    -e USE_SSL=$USE_SSL_STRING `
    -e MC_NAME=$MC_NAME `
    -v /var/run/docker.sock:/var/run/docker.sock `
    --restart unless-stopped `
    admincraft-websocket

Write-Host "Container started! WebSocket server is available at http://localhost:8080" -ForegroundColor Yellow
Write-Host "Remember to change the SECRET_KEY value in this script for production use." -ForegroundColor Red