# ChatGPT Export to Markdown PowerShell Script
# Processes ChatGPT JSON exports and converts to organized Markdown files

param(
    [Parameter(Mandatory=$true)]
    [string]$ZipPath,
    
    [Parameter(Mandatory=$false)]
    [string]$OutputPath = "C:\ChatExports",
    
    [Parameter(Mandatory=$false)]
    [switch]$UploadToDiscord,
    
    [Parameter(Mandatory=$false)]
    [string]$DiscordWebhook = $env:DISCORD_WEBHOOK_URL
)

# Ensure output directory exists
New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null

# Extract ZIP file
Write-Host "📦 Extracting ChatGPT export..." -ForegroundColor Cyan
$TempPath = Join-Path $env:TEMP "chatgpt_export_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Expand-Archive -Path $ZipPath -DestinationPath $TempPath -Force

# Find conversations.json
$ConversationsFile = Get-ChildItem -Path $TempPath -Filter "conversations.json" -Recurse | Select-Object -First 1

if (-not $ConversationsFile) {
    Write-Error "❌ conversations.json not found in export!"
    exit 1
}

# Load conversations
Write-Host "📄 Loading conversations..." -ForegroundColor Cyan
$Conversations = Get-Content $ConversationsFile.FullName | ConvertFrom-Json

# Tag classification rules
$TagRules = @{
    'NetSuite/P21' = @('netsuite', 'p21', 'erp', 'integration')
    'Business' = @('meeting', 'strategy', 'planning', 'budget', 'revenue')
    'Development' = @('code', 'github', 'deploy', 'bug', 'feature', 'script')
    'Tools' = @('notion', 'discord', 'chatgpt', 'claude', 'shareX')
    'Vegas/MGM' = @('vegas', 'mgm', 'conference', 'travel', 'hotel')
    'Cooking' = @('recipe', 'cook', 'food', 'meal', 'dinner')
    'Family' = @('family', 'personal', 'vacation', 'home')
    'Tech/Hardware' = @('server', 'hardware', 'network', 'setup', 'computer')
}

# Function to classify conversation
function Get-ConversationTag {
    param([string]$Title, [string]$Content)
    
    $Combined = "$Title $Content".ToLower()
    
    foreach ($Tag in $TagRules.Keys) {
        foreach ($Keyword in $TagRules[$Tag]) {
            if ($Combined -like "*$Keyword*") {
                return $Tag
            }
        }
    }
    
    return "Uncategorized"
}

# Function to format timestamp
function Format-Timestamp {
    param($Timestamp)
    
    if ($Timestamp -is [string]) {
        return [DateTime]::Parse($Timestamp).ToString("yyyy-MM-dd HH:mm:ss UTC")
    }
    return [DateTime]::new(1970,1,1,0,0,0,0,[DateTimeKind]::Utc).AddSeconds($Timestamp).ToString("yyyy-MM-dd HH:mm:ss UTC")
}

# Process each conversation
$ProcessedCount = 0
$ConversationsByTag = @{}

foreach ($Conversation in $Conversations) {
    $ProcessedCount++
    Write-Progress -Activity "Processing Conversations" -Status "$ProcessedCount of $($Conversations.Count)" -PercentComplete (($ProcessedCount / $Conversations.Count) * 100)
    
    $Title = $Conversation.title
    $ConvId = $Conversation.id
    $CreateTime = Format-Timestamp $Conversation.create_time
    
    # Build full conversation text for tagging
    $FullText = ""
    $Messages = @()
    
    foreach ($Node in $Conversation.mapping.PSObject.Properties.Value) {
        if ($Node.message -and $Node.message.content -and $Node.message.content.parts) {
            $Role = $Node.message.author.role
            $Text = $Node.message.content.parts -join " "
            $FullText += " $Text"
            
            $Messages += [PSCustomObject]@{
                Role = $Role
                Text = $Text
                Timestamp = if ($Node.message.create_time) { Format-Timestamp $Node.message.create_time } else { $CreateTime }
            }
        }
    }
    
    # Classify conversation
    $Tag = Get-ConversationTag -Title $Title -Content $FullText
    
    # Create markdown content
    $Markdown = @"
# Conversation: $Title
**Conversation ID:** $ConvId  
**Created:** $CreateTime  
**Tag:** $Tag  
**Messages:** $($Messages.Count)  

---

"@
    
    foreach ($Message in $Messages) {
        $Markdown += @"
### [$($Message.Role)] $($Message.Timestamp)
$($Message.Text)

"@
    }
    
    # Save individual conversation file
    $SafeTitle = $Title -replace '[<>:"/\\|?*]', '_'
    $FileName = "$($ConvId)_$($SafeTitle.Substring(0, [Math]::Min($SafeTitle.Length, 50))).md"
    $FilePath = Join-Path $OutputPath $FileName
    
    $Markdown | Out-File -FilePath $FilePath -Encoding UTF8
    
    # Group by tag for summary
    if (-not $ConversationsByTag.ContainsKey($Tag)) {
        $ConversationsByTag[$Tag] = @()
    }
    $ConversationsByTag[$Tag] += [PSCustomObject]@{
        ID = $ConvId
        Title = $Title
        Created = $CreateTime
        Messages = $Messages.Count
        File = $FileName
    }
}

# Create summary markdown
$SummaryMarkdown = @"
# ChatGPT Export Summary
**Export Date:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")  
**Total Conversations:** $($Conversations.Count)  
**Output Directory:** $OutputPath  

## Conversations by Tag

"@

foreach ($Tag in $ConversationsByTag.Keys | Sort-Object) {
    $TagConversations = $ConversationsByTag[$Tag]
    $SummaryMarkdown += @"
### $Tag ($($TagConversations.Count) conversations)

| Title | Created | Messages | File |
|-------|---------|----------|------|
"@
    
    foreach ($Conv in $TagConversations | Sort-Object Created -Descending | Select-Object -First 10) {
        $SummaryMarkdown += "| $($Conv.Title) | $($Conv.Created) | $($Conv.Messages) | $($Conv.File) |`n"
    }
    
    if ($TagConversations.Count -gt 10) {
        $SummaryMarkdown += "| _...and $($TagConversations.Count - 10) more_ | | | |`n"
    }
    
    $SummaryMarkdown += "`n"
}

# Save summary
$SummaryPath = Join-Path $OutputPath "_SUMMARY.md"
$SummaryMarkdown | Out-File -FilePath $SummaryPath -Encoding UTF8

# Create ZIP archive
Write-Host "📦 Creating archive..." -ForegroundColor Cyan
$ZipOutputPath = Join-Path (Split-Path $OutputPath -Parent) "ChatGPT_Export_$(Get-Date -Format 'yyyyMMdd_HHmmss').zip"
Compress-Archive -Path "$OutputPath\*" -DestinationPath $ZipOutputPath -Force

Write-Host "✅ Export complete!" -ForegroundColor Green
Write-Host "📁 Individual conversations: $OutputPath" -ForegroundColor Yellow
Write-Host "📄 Summary: $SummaryPath" -ForegroundColor Yellow
Write-Host "📦 Archive: $ZipOutputPath" -ForegroundColor Yellow

# Upload to Discord if requested
if ($UploadToDiscord -and $DiscordWebhook) {
    Write-Host "📤 Uploading summary to Discord..." -ForegroundColor Cyan
    
    $WebhookPayload = @{
        content = "📊 **ChatGPT Export Complete**"
        embeds = @(
            @{
                title = "Export Summary"
                description = "Processed $($Conversations.Count) conversations"
                color = 0x00FF00
                fields = @(
                    @{
                        name = "Export Date"
                        value = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
                        inline = $true
                    }
                    @{
                        name = "Total Conversations"
                        value = $Conversations.Count
                        inline = $true
                    }
                )
                footer = @{
                    text = "Archive ready for download"
                }
            }
        )
    } | ConvertTo-Json -Depth 10
    
    try {
        Invoke-RestMethod -Uri $DiscordWebhook -Method Post -Body $WebhookPayload -ContentType "application/json"
        Write-Host "✅ Discord notification sent!" -ForegroundColor Green
    }
    catch {
        Write-Warning "Failed to send Discord notification: $_"
    }
}

# Cleanup temp files
Remove-Item -Path $TempPath -Recurse -Force

Write-Host "`n✨ All done! Your ChatGPT conversations are now organized and ready." -ForegroundColor Magenta
