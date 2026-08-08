# VitaNova API — the image Render builds and runs.
#
# Docker rather than Render's native Python runtime because WeasyPrint needs
# Pango at the OS level, and the native runtime gives no way to install it.

FROM python:3.13-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Pango is WeasyPrint's text engine (cairo is no longer needed — WeasyPrint
# draws PDFs itself since v53). The fonts matter: templates ask for Helvetica,
# Arial and Georgia, none of which exist on Debian. Liberation is metric-
# compatible with Arial/Helvetica/Times, so line breaks land where they do on a
# Mac; DejaVu is the catch-all fallback.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libpango-1.0-0 \
      libpangoft2-1.0-0 \
      libharfbuzz0b \
      libffi8 \
      fontconfig \
      fonts-liberation2 \
      fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Nothing is written to disk at runtime, so the app has no business running as root.
RUN useradd --create-home --uid 10001 vitanova
USER vitanova

# Render injects $PORT and expects the process to bind it on 0.0.0.0.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
