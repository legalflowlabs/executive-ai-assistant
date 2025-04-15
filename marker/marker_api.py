from fastapi import FastAPI, UploadFile, Form
from marker.convert import convert_single_pdf
from marker.settings import settings
import tempfile
import os

app = FastAPI()

@app.post("/process")
async def process_file(
    file: UploadFile,
    options: str = Form("{}")
):
    # Save temp file
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    
    try:
        # Process with Marker
        full_text = convert_single_pdf(
            tmp_path,
            **eval(options)
        )
        return {"text": full_text}
    finally:
        os.unlink(tmp_path)