from pypdf import PdfReader


def parse_pdf(file) -> str:
    """Extract text from PDF file."""
    reader = PdfReader(file)
    text = ""

    for page in reader.pages:
        text += page.extract_text() or ""

    return text


def parse_text(file) -> str:
    """Extract text from plain text file."""
    return file.read().decode("utf-8")
