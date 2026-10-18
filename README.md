# EndoReport

Offline **endoscopy & colonoscopy reporting station** for Windows.

No installation, no Node.js and no internet connection required.

## Download

**[⬇ EndoReport-Portable-Windows.zip](https://github.com/hbanna2014-svg/endo-report/releases/latest/download/EndoReport-Portable-Windows.zip)** (~119 MB)

## How to run

1. Download the ZIP.
2. Extract the **whole folder** somewhere permanent, e.g. `D:\EndoReport`.
   Do not run it from inside the ZIP.
3. Double-click **`EndoReport.exe`**.
4. The first launch takes 5–15 seconds while the local database is created.

If Windows shows *"Windows protected your PC"*, click **More info → Run anyway**
(the file is not code-signed yet).

## Where your data is stored

```
C:\Users\<you>\Documents\EndoReportData\
    db\       patient database
    media\    captured images and video
    exports\  Word / PDF files
```

Back it up with **Backup ▸ Backup now**.

## Features

- 19 anatomical sections, 121 structured findings (OGD, colonoscopy, sigmoidoscopy, polypectomy)
- Auto-generated FINDINGS, `Biopsy:-` line and COMMENTS, grouped by organ
- 25-rule completeness / safety audit — blocking errors prevent finalising a report
- Live capture from a video-endoscopy capture card, captions, video recording
- One-page report in the classic station layout: letterhead, identity block,
  image grid, FINDINGS, COMMENTS, signature
- MS Word (.docx), PDF and direct printing — all offline
- Patients archive, doctors / referrers archive, report templates, backup & restore

## বাংলা

**ডাউনলোড:** উপরের লিংক থেকে ZIP নামান।

1. পুরো ফোল্ডারটি কোথাও এক্সট্র্যাক্ট করুন (যেমন `D:\EndoReport`) — জিপের ভেতর থেকে চালাবেন না।
2. `EndoReport.exe` ডাবল-ক্লিক করুন।
3. প্রথমবার ৫–১৫ সেকেন্ড সময় নেবে।

Windows যদি নীল *"Windows protected your PC"* দেখায় → **More info → Run anyway**।

ডেটা থাকবে `Documents\EndoReportData\` ফোল্ডারে। প্রতিদিন **Backup ▸ Backup now** চেপে কপি রাখুন।

## Releases

| Version | Notes |
|---|---|
| [v0.2.0](https://github.com/hbanna2014-svg/endo-report/releases/tag/v0.2.0) | First portable build — full reporting station, Word/PDF export, capture screen |
