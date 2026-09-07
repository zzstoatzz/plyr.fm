FROM python:3.13-slim@sha256:f82c96458eedc847b233e582eb31336f4954b39cae020b6dcf5b3ed0e5cbcd74
RUN pip install --no-cache-dir numpy==2.5.3
USER 65534:65534
WORKDIR /output
ENTRYPOINT ["python", "-I", "/input/compose.py"]
