FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=5

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt
ARG DEBIAN_MIRROR=https://ftp.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=https://security.debian.org/debian-security
RUN sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|; s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=2 -o Acquire::https::Timeout=30 update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='BAAI/bge-small-zh-v1.5', cache_dir='/opt/models')"

COPY backend/app ./app
COPY process_docs.py test_ocr.py ./

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
