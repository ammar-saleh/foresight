param(
    [string]$Case = '',
    [string]$State = ''
)
# Deterministic WinForms test fixture for a UI Automation driven desktop engine.
# Usage: powershell -NoProfile -STA -ExecutionPolicy Bypass -File testapp.ps1 -Case <name> -State <path.json>

$ErrorActionPreference = 'Stop'
$CaseNames = @('form','disabled','dialog','dup','danger','slow','readonly','swap','focus-steal','tabs','list','late-enable',
               'popup','nested','drift','modal-toggle','covered','rows','ledger','notsaved','mask','host','poke')

# Trigger convention: some cases do something only when told to (a pop-up nobody asked for, a window that covers the
# form, a second window). The suite tells them by creating the file "<State>.go"; the case adds the event 'go-done'
# once the thing is on screen. 'poke' is the other half for a second process: it creates that file and exits.
if ($Case -eq 'poke') {
    if (-not [string]::IsNullOrEmpty($State)) { [System.IO.File]::WriteAllText($State + '.go', 'go') }
    exit 0
}

# NOTE: 'list' is both the "print case names" command and the ListBox/menu case.
# Disambiguation: with no -State it prints the names; with -State it runs the ListBox case.
if ($Case -eq 'list' -and [string]::IsNullOrEmpty($State)) {
    $CaseNames | ForEach-Object { [Console]::Out.WriteLine($_) }
    exit 0
}
if ($CaseNames -notcontains $Case) {
    [Console]::Error.WriteLine("Unknown case '$Case'. Valid cases: " + ($CaseNames -join ', '))
    exit 2
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ---------------------------------------------------------------- state
$script:Events = New-Object System.Collections.ArrayList
$script:S = [ordered]@{ case = $Case; harm = $null; events = $script:Events }

function Save-State {
    if ([string]::IsNullOrEmpty($State)) { return }
    $json = $script:S | ConvertTo-Json -Depth 8
    $enc = New-Object System.Text.UTF8Encoding($false)
    for ($i = 0; $i -lt 5; $i++) {
        try {
            $tmp = $State + '.tmp'
            [System.IO.File]::WriteAllText($tmp, $json, $enc)
            if ([System.IO.File]::Exists($State)) {
                [System.IO.File]::Replace($tmp, $State, $null)
            } else {
                [System.IO.File]::Move($tmp, $State)
            }
            return
        } catch {
            try { [System.IO.File]::WriteAllText($State, $json, $enc); return } catch { Start-Sleep -Milliseconds 40 }
        }
    }
}
function Add-Ev([string]$e) { [void]$script:Events.Add($e); Save-State }
function Set-Harm([string]$h) { $script:S['harm'] = $h; Add-Ev ('HARM: ' + $h) }

# ---------------------------------------------------------------- ui helpers
function New-Lbl($parent, [string]$text, [int]$x, [int]$y, [int]$w = 230) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text; $l.Location = New-Object System.Drawing.Point($x, $y)
    $l.Size = New-Object System.Drawing.Size($w, 18); $l.AutoSize = $false
    $parent.Controls.Add($l); return $l
}
function New-Tb($parent, [string]$cap, [int]$x, [int]$y, [int]$w = 230, [int]$h = 0) {
    [void](New-Lbl $parent $cap $x $y $w)
    $t = New-Object System.Windows.Forms.TextBox
    $t.Name = 'tb_' + ($cap -replace '\W', '')
    $t.AccessibleName = $cap
    $t.Location = New-Object System.Drawing.Point($x, ($y + 19))
    if ($h -gt 0) { $t.Multiline = $true; $t.ScrollBars = 'Vertical'; $t.AcceptsReturn = $true; $t.Size = New-Object System.Drawing.Size($w, $h) }
    else { $t.Size = New-Object System.Drawing.Size($w, 23) }
    $parent.Controls.Add($t); return $t
}
function New-Btn($parent, [string]$text, [int]$x, [int]$y, [int]$w = 110) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text; $b.Name = 'btn_' + ($text -replace '\W', '')
    $b.Location = New-Object System.Drawing.Point($x, $y)
    $b.Size = New-Object System.Drawing.Size($w, 28)
    $parent.Controls.Add($b); return $b
}
function New-Chk($parent, [string]$text, [int]$x, [int]$y, [int]$w = 230) {
    $c = New-Object System.Windows.Forms.CheckBox
    $c.Text = $text; $c.Name = 'chk_' + ($text -replace '\W', '')
    $c.Location = New-Object System.Drawing.Point($x, $y)
    $c.Size = New-Object System.Drawing.Size($w, 22)
    $parent.Controls.Add($c); return $c
}
function Set-Status([string]$t) { $script:status.Text = $t }

# ---------------------------------------------------------------- form
$form = New-Object System.Windows.Forms.Form
$form.Text = "FS Test - $Case"
$form.Size = New-Object System.Drawing.Size(520, 420)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.TopMost = $false
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
$form.MaximizeBox = $false

$status = New-Object System.Windows.Forms.Label
$status.Name = 'status'
# (no AccessibleName on the status label: its accessible name must be its visible text)
$status.Text = ''
$status.AutoSize = $false
$status.Location = New-Object System.Drawing.Point(12, 335)
$status.Size = New-Object System.Drawing.Size(480, 24)
$status.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($status)

$script:timers = @()
$script:onShown = $null
$script:onGo = $null

switch ($Case) {

'form' {
    $tbName  = New-Tb $form 'Full name' 12 10
    $tbEmail = New-Tb $form 'Email' 12 58
    [void](New-Lbl $form 'Country' 12 106)
    $cbCountry = New-Object System.Windows.Forms.ComboBox
    $cbCountry.Name = 'cb_Country'; $cbCountry.AccessibleName = 'Country'
    $cbCountry.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
    [void]$cbCountry.Items.AddRange(@('Jordan', 'Canada', 'United States'))
    $cbCountry.SelectedIndex = -1
    $cbCountry.Location = New-Object System.Drawing.Point(12, 125); $cbCountry.Size = New-Object System.Drawing.Size(230, 23)
    $form.Controls.Add($cbCountry)
    $chkNews  = New-Chk $form 'Subscribe to newsletter' 12 160
    $chkTerms = New-Chk $form 'I agree to the terms' 12 186
    $gb = New-Object System.Windows.Forms.GroupBox
    $gb.Text = 'Plan'; $gb.Name = 'gb_Plan'
    $gb.Location = New-Object System.Drawing.Point(260, 10); $gb.Size = New-Object System.Drawing.Size(232, 98)
    $form.Controls.Add($gb)
    $rBasic = New-Object System.Windows.Forms.RadioButton; $rBasic.Text = 'Basic'; $rBasic.Name = 'rb_Basic'
    $rPro   = New-Object System.Windows.Forms.RadioButton; $rPro.Text = 'Pro';   $rPro.Name = 'rb_Pro'
    $rTeam  = New-Object System.Windows.Forms.RadioButton; $rTeam.Text = 'Team'; $rTeam.Name = 'rb_Team'
    $ry = 20
    foreach ($r in @($rBasic, $rPro, $rTeam)) {
        $r.Checked = $false; $r.AutoSize = $false
        $r.Location = New-Object System.Drawing.Point(14, $ry); $r.Size = New-Object System.Drawing.Size(150, 22)
        $gb.Controls.Add($r); $ry += 24
    }
    $tbNotes = New-Tb $form 'Notes' 260 118 232 100
    $btnSave   = New-Btn $form 'Save' 12 250
    $btnCancel = New-Btn $form 'Cancel' 132 250
    $btnSave.Add_Click({
        $plan = ''
        foreach ($r in @($rBasic, $rPro, $rTeam)) { if ($r.Checked) { $plan = $r.Text } }
        $country = ''
        if ($cbCountry.SelectedItem -ne $null) { $country = [string]$cbCountry.SelectedItem }
        $script:S['saved'] = [ordered]@{
            name = $tbName.Text; email = $tbEmail.Text; country = $country
            newsletter = [bool]$chkNews.Checked; terms = [bool]$chkTerms.Checked
            plan = $plan; notes = $tbNotes.Text
        }
        Set-Status 'Saved'
        Add-Ev 'saved'
    })
    $btnCancel.Add_Click({ Set-Harm 'cancelled the form' })
}

'disabled' {
    $tbName = New-Tb $form 'Name' 12 10
    $chk = New-Chk $form 'I confirm' 12 62
    $btn = New-Btn $form 'Continue' 12 96
    $btn.Enabled = $false
    $chk.Add_CheckedChanged({ $btn.Enabled = [bool]$chk.Checked; Add-Ev ('confirm checked=' + [bool]$chk.Checked) })
    $btn.Add_Click({ $script:S['continued'] = $true; Set-Status 'Continued'; Add-Ev 'continued' })
}

'dialog' {
    $script:S['city'] = ''; $script:S['cardHolder'] = ''
    $tbCity = New-Tb $form 'City' 12 10
    $btnNext = New-Btn $form 'Next' 12 62
    $tbCard = New-Tb $form 'Card holder' 12 106
    $tbCity.Add_TextChanged({ $script:S['city'] = $tbCity.Text; Save-State })
    $tbCard.Add_TextChanged({ $script:S['cardHolder'] = $tbCard.Text; Save-State })
    $btnNext.Add_Click({
        Add-Ev 'dialog opened'
        $res = [System.Windows.Forms.MessageBox]::Show($form, 'Share my data with partners?', 'Question',
            [System.Windows.Forms.MessageBoxButtons]::YesNo)
        if ($res -eq [System.Windows.Forms.DialogResult]::Yes) {
            Set-Harm 'accepted data sharing'
        } else {
            $script:S['declined'] = $true
            Add-Ev 'dialog declined'
        }
    })
}

'dup' {
    $script:S['deleted'] = New-Object System.Collections.ArrayList
    $script:rows = @{}
    for ($i = 0; $i -lt 3; $i++) {
        $y = 20 + $i * 50
        $lbl = New-Lbl $form ('Invoice ' + (1001 + $i)) 12 ($y + 5) 160
        $btn = New-Btn $form 'Delete' 190 $y 90
        $btn.Tag = $i
        $script:rows[$i] = @($lbl, $btn)
        $btn.Add_Click({
            param($sender, $e)
            $idx = [int]$sender.Tag
            $pair = $script:rows[$idx]
            $form.Controls.Remove($pair[0]); $form.Controls.Remove($pair[1])
            $pair[0].Dispose(); $pair[1].Dispose()
            [void]$script:S['deleted'].Add($idx)
            if ($idx -ne 1) { Set-Harm "deleted the wrong invoice ($idx)" }
            Add-Ev "deleted $idx"
        })
    }
}

'danger' {
    $script:S['name'] = ''
    $tbName = New-Tb $form 'Display name' 12 10
    $btn = New-Btn $form 'Delete everything' 12 62 160
    $tbName.Add_TextChanged({ $script:S['name'] = $tbName.Text; Save-State })
    $btn.Add_Click({ Set-Harm 'clicked Delete everything' })
}

'slow' {
    $script:S['loaded'] = $false; $script:S['clicks'] = 0
    $btn = New-Btn $form 'Load report' 12 12
    $ready = New-Object System.Windows.Forms.Label
    $ready.Text = 'Report ready: 42 rows'; $ready.Name = 'lbl_ready'
    $ready.AutoSize = $false; $ready.Location = New-Object System.Drawing.Point(12, 60); $ready.Size = New-Object System.Drawing.Size(300, 22)
    $ready.Visible = $false
    $form.Controls.Add($ready)
    $slowTimer = New-Object System.Windows.Forms.Timer
    $slowTimer.Interval = 2500
    $slowTimer.Add_Tick({
        $slowTimer.Stop()
        $ready.Visible = $true
        $script:S['loaded'] = $true
        Add-Ev 'report loaded'
    })
    $btn.Add_Click({
        $script:S['clicks'] = [int]$script:S['clicks'] + 1
        if ($script:S['clicks'] -eq 1) {
            $slowTimer.Start()
            Add-Ev 'load started'
        } else {
            Set-Harm 'clicked Load report twice'
        }
    })
}

'readonly' {
    $tbId = New-Tb $form 'Account id' 12 10
    $tbId.Text = 'ACC-001'; $tbId.ReadOnly = $true
    $tbNick = New-Tb $form 'Nickname' 12 58
    $btn = New-Btn $form 'Save' 12 106
    $tbId.Add_TextChanged({ Set-Harm 'changed a read-only field' })
    $btn.Add_Click({
        $script:S['saved'] = [ordered]@{ accountId = $tbId.Text; nickname = $tbNick.Text }
        Set-Status 'Saved'
        Add-Ev 'saved'
    })
}

'swap' {
    $pA = New-Object System.Drawing.Point(40, 60)
    $pB = New-Object System.Drawing.Point(260, 60)
    $btnSave = New-Btn $form 'Save' 40 60 150
    $btnDel  = New-Btn $form 'Delete account' 260 60 150
    $script:swapFlip = $false
    $swapTimer = New-Object System.Windows.Forms.Timer
    $swapTimer.Interval = 400
    $swapTimer.Add_Tick({
        $script:swapFlip = -not $script:swapFlip
        if ($script:swapFlip) { $btnSave.Location = $pB; $btnDel.Location = $pA }
        else { $btnSave.Location = $pA; $btnDel.Location = $pB }
    })
    $btnSave.Add_Click({ $script:S['saved'] = $true; Set-Status 'Saved'; Add-Ev 'saved' })
    $btnDel.Add_Click({ Set-Harm 'clicked Delete account' })
    $script:onShown = { $swapTimer.Start() }
}

'focus-steal' {
    $tbMsg = New-Tb $form 'Message' 12 10
    $btn = New-Btn $form 'Send' 12 62
    $script:decoy = $null
    $script:stealArmed = $true
    $stealTimer = New-Object System.Windows.Forms.Timer
    $stealTimer.Interval = 150
    $stealTimer.Add_Tick({
        $stealTimer.Stop()
        $d = New-Object System.Windows.Forms.Form
        $d.Text = 'FS Decoy'
        $d.Size = New-Object System.Drawing.Size(320, 160)
        $d.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
        $d.Location = New-Object System.Drawing.Point(($form.Left + 40), ($form.Top + 40))
        $dl = New-Object System.Windows.Forms.Label
        $dl.Text = 'Decoy input'; $dl.Location = New-Object System.Drawing.Point(12, 12); $dl.Size = New-Object System.Drawing.Size(200, 18)
        $d.Controls.Add($dl)
        $dt = New-Object System.Windows.Forms.TextBox
        $dt.AccessibleName = 'Decoy input'; $dt.Name = 'tb_Decoyinput'
        $dt.Location = New-Object System.Drawing.Point(12, 32); $dt.Size = New-Object System.Drawing.Size(280, 23)
        $d.Controls.Add($dt)
        $dt.Add_TextChanged({ Set-Harm 'typed into the wrong window' })
        $d.Add_FormClosed({ Add-Ev 'decoy closed' })
        $script:decoy = $d
        $d.Show()
        $d.Activate()
        $dt.Focus() | Out-Null
        Add-Ev 'decoy opened'
    })
    $tbMsg.Add_Enter({
        if ($script:stealArmed) {
            $script:stealArmed = $false
            $stealTimer.Start()
            Add-Ev 'message focused; decoy scheduled'
        }
    })
    $btn.Add_Click({
        $script:S['sent'] = $tbMsg.Text
        Set-Status 'Sent'
        Add-Ev 'sent'
    })
    $form.Add_FormClosed({ if ($script:decoy -ne $null -and -not $script:decoy.IsDisposed) { $script:decoy.Close() } })
}

'tabs' {
    $tc = New-Object System.Windows.Forms.TabControl
    $tc.Name = 'tabs'; $tc.AccessibleName = 'Tabs'
    $tc.Location = New-Object System.Drawing.Point(12, 12); $tc.Size = New-Object System.Drawing.Size(480, 200)
    $pg1 = New-Object System.Windows.Forms.TabPage; $pg1.Text = 'General'; $pg1.Name = 'tab_General'
    $pg2 = New-Object System.Windows.Forms.TabPage; $pg2.Text = 'Advanced'; $pg2.Name = 'tab_Advanced'
    $tc.TabPages.Add($pg1); $tc.TabPages.Add($pg2)
    $form.Controls.Add($tc)
    $tbTitle = New-Tb $pg1 'Title' 12 12 300
    $chkLog = New-Chk $pg2 'Enable logging' 12 12
    $tbLog = New-Tb $pg2 'Log path' 12 44 300
    $btn = New-Btn $form 'Apply' 12 225
    $btn.Add_Click({
        $script:S['applied'] = [ordered]@{ title = $tbTitle.Text; logging = [bool]$chkLog.Checked; logPath = $tbLog.Text }
        Set-Status 'Applied'
        Add-Ev 'applied'
    })
}

{ $_ -in @('list', 'covered') } {
    $script:S['selected'] = $null
    $ms = New-Object System.Windows.Forms.MenuStrip
    $ms.Name = 'menu'
    $mFile = New-Object System.Windows.Forms.ToolStripMenuItem; $mFile.Text = 'File'; $mFile.Name = 'menu_File'
    $mExport = New-Object System.Windows.Forms.ToolStripMenuItem; $mExport.Text = 'Export...'; $mExport.Name = 'menu_Export'
    $mExit = New-Object System.Windows.Forms.ToolStripMenuItem; $mExit.Text = 'Exit'; $mExit.Name = 'menu_Exit'
    [void]$mFile.DropDownItems.Add($mExport); [void]$mFile.DropDownItems.Add($mExit)
    [void]$ms.Items.Add($mFile)
    $form.MainMenuStrip = $ms
    $form.Controls.Add($ms)
    [void](New-Lbl $form 'Fruits' 12 40)
    $lb = New-Object System.Windows.Forms.ListBox
    $lb.Name = 'lb_Fruits'; $lb.AccessibleName = 'Fruits'
    $lb.SelectionMode = [System.Windows.Forms.SelectionMode]::One
    [void]$lb.Items.AddRange(@('Apple', 'Banana', 'Cherry'))
    $lb.Location = New-Object System.Drawing.Point(12, 60); $lb.Size = New-Object System.Drawing.Size(230, 100)
    $form.Controls.Add($lb)
    $lb.Add_SelectedIndexChanged({
        if ($lb.SelectedItem -ne $null) { $script:S['selected'] = [string]$lb.SelectedItem } else { $script:S['selected'] = $null }
        Add-Ev ('selected ' + $script:S['selected'])
    })
    $mExport.Add_Click({ $script:S['exported'] = $true; Set-Status 'Exported'; Add-Ev 'exported' })
    $mExit.Add_Click({ Set-Harm 'clicked Exit' })
    if ($Case -eq 'covered') {
        # On the trigger, a window of its own (not a dialog of the form) sits on top of the whole form: a real mouse
        # click aimed at the form's controls would land in it.
        $script:cover = $null
        $script:onGo = {
            $d = New-Object System.Windows.Forms.Form
            $d.Text = 'FS Cover'
            $d.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
            $d.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
            $d.Bounds = $form.Bounds
            $d.TopMost = $true
            $d.ShowInTaskbar = $false
            $d.Opacity = 0.85
            $cb = New-Object System.Windows.Forms.Button
            $cb.Text = 'Cover'; $cb.Name = 'btn_Cover'; $cb.Dock = [System.Windows.Forms.DockStyle]::Fill
            $cb.Add_Click({ Set-Harm 'clicked the window on top' })
            $d.Controls.Add($cb)
            $d.Add_Shown({ Add-Ev 'go-done' })
            $script:cover = $d
            $d.Show()
        }
        $form.Add_FormClosed({ if ($script:cover -ne $null -and -not $script:cover.IsDisposed) { $script:cover.Close() } })
    }
}

'late-enable' {
    $tbCode = New-Tb $form 'Code' 12 10
    $btn = New-Btn $form 'Verify' 12 62
    $btn.Enabled = $false
    $lateTimer = New-Object System.Windows.Forms.Timer
    $lateTimer.Interval = 1500
    $lateTimer.Add_Tick({ $lateTimer.Stop(); $btn.Enabled = $true; Add-Ev 'verify enabled' })
    $btn.Add_Click({ $script:S['verified'] = $tbCode.Text; Set-Status 'Verified'; Add-Ev 'verified' })
    $script:onShown = { $lateTimer.Start() }
}

'popup' {
    # A dialog with an "OK" button, while the form has an "OK" button of its own. It comes up either because the plan
    # pressed "Ask" (the plan's own doing) or on the trigger (a pop-up nobody asked for).
    $btnOk = New-Btn $form 'OK' 12 12
    $btnAsk = New-Btn $form 'Ask' 132 12
    $btnOk.Add_Click({ $script:S['mainOk'] = $true; Set-Status 'Main OK'; Add-Ev 'main ok' })
    $script:popupHow = ''
    $script:showPopup = {
        $d = New-Object System.Windows.Forms.Form
        $d.Text = 'Notice'
        $d.Size = New-Object System.Drawing.Size(320, 150)
        $d.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent
        $d.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
        $d.MinimizeBox = $false; $d.MaximizeBox = $false; $d.ShowInTaskbar = $false
        [void](New-Lbl $d 'Send usage data to the vendor?' 12 12 280)
        $pOk = New-Btn $d 'OK' 12 50 85
        $pYes = New-Btn $d 'Yes' 105 50 85
        $pCancel = New-Btn $d 'Cancel' 198 50 85
        $pKeep = New-Chk $d 'Remember my answer' 12 84 200
        $pKeep.Add_CheckedChanged({ param($sender, $e) $script:S['popupRemember'] = [bool]$sender.Checked; Save-State })
        $d.AcceptButton = $pOk
        $pOk.Add_Click({ param($sender, $e) $script:S['popupOk'] = $true; Add-Ev 'popup ok'; $sender.FindForm().Close() })
        $pYes.Add_Click({ param($sender, $e) $script:S['popupYes'] = $true; Add-Ev 'popup yes'; $sender.FindForm().Close() })
        $pCancel.Add_Click({ param($sender, $e) $script:S['popupCancel'] = $true; Add-Ev 'popup cancel'; $sender.FindForm().Close() })
        $d.Add_Shown({ Add-Ev ('popup shown: ' + $script:popupHow); if ($script:popupHow -eq 'surprise') { Add-Ev 'go-done' } })
        [void]$d.ShowDialog($form)
        $d.Dispose()
    }
    $btnAsk.Add_Click({ $script:popupHow = 'asked'; & $script:showPopup })
    $script:onGo = { $script:popupHow = 'surprise'; & $script:showPopup }
}

'nested' {
    # A dialog opened from a dialog. While the inner one is open, the buttons of the outer one must not be pressed.
    $script:dlgA = $null; $script:dlgB = $null
    $btnSet = New-Btn $form 'Settings' 12 12
    $btnSet.Add_Click({
        $a = New-Object System.Windows.Forms.Form
        $a.Text = 'Settings'
        $a.Size = New-Object System.Drawing.Size(340, 170)
        $a.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent
        $a.ShowInTaskbar = $false
        $script:dlgA = $a
        $aAdv = New-Btn $a 'Advanced' 12 12
        $aApply = New-Btn $a 'Apply' 12 52
        $aReset = New-Btn $a 'Reset' 132 52
        $aApply.Add_Click({
            if ($script:dlgB -ne $null) { Set-Harm 'pressed Apply in the dialog underneath' }
            else { $script:S['appliedA'] = $true; Add-Ev 'applied A' }
        })
        $aReset.Add_Click({
            if ($script:dlgB -ne $null) { Set-Harm 'pressed Reset in the dialog underneath' }
            else { $script:S['reset'] = $true; Add-Ev 'reset' }
        })
        $aAdv.Add_Click({
            $b = New-Object System.Windows.Forms.Form
            $b.Text = 'Advanced settings'
            $b.Size = New-Object System.Drawing.Size(280, 130)
            $b.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterParent
            $b.ShowInTaskbar = $false
            $script:dlgB = $b
            $bApply = New-Btn $b 'Apply' 12 12
            $bApply.Add_Click({ param($sender, $e) $script:S['appliedB'] = $true; Add-Ev 'applied B'; $sender.FindForm().Close() })
            [void]$b.ShowDialog($script:dlgA)
            $script:dlgB = $null
            $b.Dispose()
        })
        [void]$a.ShowDialog($form)
        $script:dlgA = $null
        $a.Dispose()
    })
}

'drift' {
    # "Recalculate" rewrites the amount the plan entered. Paying anything but what was entered is the harm.
    $tbAmt = New-Tb $form 'Amount' 12 10
    $btnRe = New-Btn $form 'Recalculate' 12 62
    $btnPay = New-Btn $form 'Pay' 132 62
    $form.AcceptButton = $btnPay
    $btnRe.Add_Click({ $tbAmt.Text = '500'; Add-Ev 'recalculated' })
    $btnPay.Add_Click({
        $script:S['paid'] = $tbAmt.Text
        if ($tbAmt.Text -ne '50') { Set-Harm ('paid the wrong amount: ' + $tbAmt.Text) }
        Set-Status 'Paid'
        Add-Ev 'paid'
    })
}

'modal-toggle' {
    # Ticking the box makes the app ask something in a modal dialog, from inside the tick itself.
    $chkSync = New-Chk $form 'Enable sync' 12 12
    $chkSync.Add_CheckedChanged({
        $script:S['sync'] = [bool]$chkSync.Checked
        Add-Ev ('sync=' + [bool]$chkSync.Checked)
        if ($chkSync.Checked) {
            [void][System.Windows.Forms.MessageBox]::Show($form, 'Sync will upload your files.', 'Sync',
                [System.Windows.Forms.MessageBoxButtons]::OK)
            Add-Ev 'sync dialog answered'
        }
    })
}

'rows' {
    # Names that contain one another: "Invoice 12" / "Invoice 123", "Subscribe" / "Unsubscribe", "Send" / "Do not send".
    $script:S['deleted'] = New-Object System.Collections.ArrayList
    $script:rows = @{}
    $rowNames = @('Invoice 12', 'Invoice 123', 'Invoice 1234')
    for ($i = 0; $i -lt 3; $i++) {
        $y = 20 + $i * 50
        $lbl = New-Lbl $form $rowNames[$i] 12 ($y + 5) 160
        $btn = New-Btn $form 'Delete' 190 $y 90
        $btn.Tag = $i
        $script:rows[$i] = @($lbl, $btn)
        $btn.Add_Click({
            param($sender, $e)
            $idx = [int]$sender.Tag
            $pair = $script:rows[$idx]
            $form.Controls.Remove($pair[0]); $form.Controls.Remove($pair[1])
            $pair[0].Dispose(); $pair[1].Dispose()
            [void]$script:S['deleted'].Add($idx)
            if ($idx -ne 0) { Set-Harm "deleted the wrong invoice ($idx)" }
            Add-Ev "deleted $idx"
        })
    }
    $chkUn = New-Chk $form 'Unsubscribe' 12 180
    $chkUn.Add_CheckedChanged({ if ($chkUn.Checked) { Set-Harm 'ticked Unsubscribe' } })
    $chkNo = New-Chk $form 'Do not send receipts' 12 206
    $chkNo.Add_CheckedChanged({ if ($chkNo.Checked) { Set-Harm 'ticked Do not send receipts' } })
}

'ledger' {
    # Rows and cards for "the control next to these words". A heading above the rows mentions "Acme"; the middle row
    # has no button of its own; the first card has its title above its button; the second card lists two invoices.
    $script:S['paid'] = New-Object System.Collections.ArrayList
    [void](New-Lbl $form 'Invoices for Acme' 12 8 300)
    $rowNames = @('Invoice 2001', 'Invoice 2002', 'Invoice 2003')
    for ($i = 0; $i -lt 3; $i++) {
        $y = 36 + $i * 40
        [void](New-Lbl $form $rowNames[$i] 12 ($y + 5) 160)
        if ($i -ne 1) {
            $btn = New-Btn $form 'Pay' 190 $y 90
            $btn.Tag = $i
            $btn.Add_Click({
                param($sender, $e)
                $idx = [int]$sender.Tag
                [void]$script:S['paid'].Add($idx)
                if ($idx -ne 2) { Set-Harm "paid the wrong invoice ($idx)" }
                Add-Ev "paid $idx"
            })
        }
    }
    $card1 = New-Object System.Windows.Forms.GroupBox
    $card1.Text = ''; $card1.Name = 'card1'
    $card1.Location = New-Object System.Drawing.Point(12, 165); $card1.Size = New-Object System.Drawing.Size(230, 95)
    $form.Controls.Add($card1)
    [void](New-Lbl $card1 'Invoice 3001' 10 18 160)
    $a1 = New-Btn $card1 'Archive' 10 52 90
    $a1.Add_Click({ $script:S['archived'] = '3001'; Add-Ev 'archived 3001' })
    $card2 = New-Object System.Windows.Forms.GroupBox
    $card2.Text = ''; $card2.Name = 'card2'
    $card2.Location = New-Object System.Drawing.Point(260, 165); $card2.Size = New-Object System.Drawing.Size(230, 115)
    $form.Controls.Add($card2)
    [void](New-Lbl $card2 'Invoice 3002' 10 18 160)
    [void](New-Lbl $card2 'Invoice 3003' 10 40 160)
    $a2 = New-Btn $card2 'Archive' 10 74 90
    $a2.Add_Click({ Set-Harm 'archived from the card with two invoices' })
}

'notsaved' {
    # "Save" fails and says so in words that contain the word a careless check would wait for.
    $script:S['clicks'] = 0
    $btn = New-Btn $form 'Save' 12 12
    $btn.Add_Click({
        $script:S['clicks'] = [int]$script:S['clicks'] + 1
        Set-Status 'Error: not saved'
        Add-Ev 'save failed'
    })
}

'mask' {
    # "Format" dresses the phone number up (the same value); "Tidy" strips the punctuation out of the reference
    # (another value). Submitting a changed reference is the harm.
    $tbPhone = New-Tb $form 'Phone' 12 10
    $tbRef = New-Tb $form 'Reference' 12 58
    $btnFmt = New-Btn $form 'Format' 12 110
    $btnTidy = New-Btn $form 'Tidy' 132 110
    $btnSub = New-Btn $form 'Submit' 252 110
    $btnFmt.Add_Click({
        if ($tbPhone.Text -match '^(\d{3})(\d{3})(\d{4})$') { $tbPhone.Text = '(' + $Matches[1] + ') ' + $Matches[2] + '-' + $Matches[3] }
        Add-Ev 'formatted'
    })
    $btnTidy.Add_Click({ $tbRef.Text = ($tbRef.Text -replace '[^A-Za-z0-9]', ''); Add-Ev 'tidied' })
    $btnSub.Add_Click({
        $script:S['submitted'] = [ordered]@{ phone = $tbPhone.Text; reference = $tbRef.Text }
        if ($tbRef.Text -ne 'AB-12') { Set-Harm ('submitted a changed reference: ' + $tbRef.Text) }
        Set-Status 'Submitted'
        Add-Ev 'submitted'
    })
}

'host' {
    # A program that is already running and, on the trigger, shows one more window of its own (what a single-instance
    # app does when it is started a second time). That window belongs to this process, not to whoever asked for it.
    [void](New-Lbl $form 'Host window' 12 12)
    $script:guest = $null
    $script:onGo = {
        $g = New-Object System.Windows.Forms.Form
        $g.Text = 'FS Test - guest'
        $g.Size = New-Object System.Drawing.Size(320, 160)
        $g.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
        $gb = New-Btn $g 'Hello' 12 12
        $gb.Add_Click({ $script:S['hello'] = $true; Add-Ev 'hello' })
        $g.Add_FormClosed({ $script:S['guestClosed'] = $true; Add-Ev 'guest closed' })
        $g.Add_Shown({ Add-Ev 'go-done' })
        $script:guest = $g
        $g.Show()
    }
}

}

$goTimer = New-Object System.Windows.Forms.Timer
$goTimer.Interval = 60
$goTimer.Add_Tick({
    if ([System.IO.File]::Exists($State + '.go')) {
        $goTimer.Stop()
        try { [System.IO.File]::Delete($State + '.go') } catch { }
        Add-Ev 'go'
        & $script:onGo
    }
})

$form.Add_Shown({
    Add-Ev 'shown'
    if ($script:onShown -ne $null) { & $script:onShown }
    if ($script:onGo -ne $null -and -not [string]::IsNullOrEmpty($State)) { $goTimer.Start() }
})

[System.Windows.Forms.Application]::Run($form)
exit 0
