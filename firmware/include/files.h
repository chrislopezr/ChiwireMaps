#ifndef FILES_H
#define FILES_H

const char files_html[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Files on SD Card</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f4f4f4;
            color: #333;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            min-height: 100vh;
            box-sizing: border-box;
        }
        h1 {
            margin: 0;
            padding: 20px;
            font-size: 32px;
            text-align: center;
        }
        input[type="text"] {
            width: 100%;
            max-width: 600px;
            padding: 10px;
            margin: 20px 0;
            font-size: 16px;
            border: 1px solid #ccc;
            border-radius: 5px;
            box-sizing: border-box;
        }
        .file-list {
            width: 100%;
            max-width: 600px;
            box-sizing: border-box;
            overflow-y: auto;
            max-height: calc(100vh - 200px); /* Adjust height based on other elements */
        }
        .file {
            padding: 15px;
            margin: 5px 0;
            background-color: #ffffff;
            box-sizing: border-box;
            word-wrap: break-word;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            cursor: pointer;
            transition: background-color 0.3s ease;
        }
        .file:hover {
            background-color: #f0f0f0;
        }
        .file a {
            text-decoration: none;
            color: inherit;
            display: block;
            width: 100%;
            height: 100%;
        }
        .file:last-child {
            border-bottom: none;
        }
        .path {
            padding: 5px 0;
            color: #666;
            font-size: 14px;
            word-wrap: break-word;
        }
        .upload {
            width: 100%;
            max-width: 600px;
            box-sizing: border-box;
            padding: 10px;
            margin: 5px 0;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .upload button { font-size: 16px; padding: 8px 12px; margin-top: 6px; }
        .upload progress { width: 100%; }
        #uploadStatus { color: #b00; margin-top: 4px; }
    </style>
    <script>
        function filterFiles() {
            var input, filter, fileDivs, a, i;
            input = document.getElementById('searchInput');
            filter = input.value.toUpperCase();
            fileDivs = document.getElementsByClassName('file');

            for (i = 0; i < fileDivs.length; i++) {
                a = fileDivs[i].getElementsByTagName('a')[0];
                if (a.innerHTML.toUpperCase().indexOf(filter) > -1) {
                    fileDivs[i].style.display = "";
                } else {
                    fileDivs[i].style.display = "none";
                }
            }
        }
    </script>
</head>
<body>
<h1>🏕️ FILES 🏔️</h1>
<input type="text" id="searchInput" onkeyup="filterFiles()" placeholder="Search for files...">
<div class="upload">
    <div id="storage" class="path">Checking free space…</div>
    <input type="file" id="uploadFile">
    <button id="uploadGo" onclick="uploadFile()">⬆️ Upload to this folder</button>
    <progress id="uploadProgress" max="1" value="0" hidden></progress>
    <div id="uploadStatus"></div>
</div>
<div class="file-list">
    <!-- FILES_PLACEHOLDER -->
</div>
<script>
    // Free space and upload. The folder is the one in the address (?dir=...), always inside /serve.
    var dir = new URLSearchParams(location.search).get('dir') || '';
    var storage = null;
    function sizeText(bytes) {
        var units = ['B', 'KB', 'MB', 'GB'], i = 0;
        while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
        return i === 0 ? bytes + ' B' : bytes.toFixed(1) + ' ' + units[i];
    }
    fetch('/storage', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (s) {
        storage = s;
        document.getElementById('storage').textContent = sizeText(s.free) + ' free of ' + sizeText(s.total) +
            ' (' + (100 * s.free / s.total).toFixed(1) + '%)';
    });
    function uploadFile() {
        var file = document.getElementById('uploadFile').files[0];
        var status = document.getElementById('uploadStatus');
        if (!file) { status.textContent = 'Choose a file first.'; return; }
        // Checked here so nothing is sent; the dongle checks again before writing
        if (storage && file.size > storage.maxUpload) {
            status.textContent = 'Too big: ' + sizeText(file.size) + ', only ' + sizeText(storage.free) +
                ' free (1 MB is kept in reserve).';
            return;
        }
        var bar = document.getElementById('uploadProgress');
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload?dir=' + encodeURIComponent(dir));
        xhr.upload.onprogress = function (e) { bar.hidden = false; bar.value = e.loaded / e.total; };
        xhr.onload = function () {
            if (xhr.status === 200) location.reload();
            else { bar.hidden = true; status.textContent = xhr.responseText; }
        };
        xhr.onerror = function () { bar.hidden = true; status.textContent = 'Upload failed (connection lost). Nothing was saved.'; };
        var form = new FormData();
        form.append('file', file, file.name);
        status.textContent = '';
        xhr.send(form);
    }
</script>
</body>
</html>
)rawliteral";

#endif // FILES_H
