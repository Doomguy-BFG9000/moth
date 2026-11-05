# moth in a container: the release's moth-linux, byte for byte, as /usr/bin/moth. Built from a folder that
# holds moth-linux:
#
#     docker build -f packaging/docker/Dockerfile -t moth <folder with moth-linux>
#     docker run --rm -v "$PWD:/work" --user "$(id -u):$(id -g)" moth run hello.moth
#
# moth is one static program, so it needs no system at all; the base is distroless's, which adds only glibc,
# OpenSSL 3, CA certificates and time zones, for the programs moth builds that load a C library (a secure
# connection loads OpenSSL). There's no shell, package manager, git or curl: moth add and moth search need
# git and curl, so fetch packages outside, or COPY --from this image into one that has them. The base is
# pinned by its digest, for the same image from the same moth-linux; DESIGN.md says how it's updated.
FROM gcr.io/distroless/base-debian13:nonroot@sha256:9039a88709bcc2bacf5a2faac331d65dd6840f763f225ad9594cc0c67bcd0fba

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Moth" \
      org.opencontainers.image.description="A programming language that reads like plain English" \
      org.opencontainers.image.url="https://github.com/samyyy2423/moth" \
      org.opencontainers.image.source="https://github.com/samyyy2423/moth" \
      org.opencontainers.image.documentation="https://github.com/samyyy2423/moth#readme" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

COPY --chmod=0755 moth-linux /usr/bin/moth
WORKDIR /work
ENTRYPOINT ["/usr/bin/moth"]
