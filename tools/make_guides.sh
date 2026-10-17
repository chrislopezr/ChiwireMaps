#!/bin/sh
# Convert the guides in docs/guides/*.md to .odt, .docx and .pdf next to them (needs LibreOffice 26.2+,
# which opens Markdown directly). Run from the repository root: sh tools/make_guides.sh
set -e
cd docs/guides
for format in odt docx pdf; do
    soffice --headless --convert-to "$format" ./*.md
done
