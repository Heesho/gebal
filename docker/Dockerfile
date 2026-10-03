# Operator-prepared, offline assembly. See docs/sandbox.md before building.
# BASE_IMAGE must be a locally available reviewed Python 3.12 Debian image by digest.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
COPY forge solc /usr/local/bin/
COPY wheels/ /tmp/wheels/
RUN python3 -m pip install --no-index --find-links=/tmp/wheels slither-analyzer==0.11.3 \
    && chmod 0755 /usr/local/bin/forge /usr/local/bin/solc \
    && ln -sf /usr/local/bin/python3 /usr/bin/python3 \
    && rm -rf /tmp/wheels \
    && forge --version && slither --version && solc --version
USER 65534:65534
WORKDIR /work
# Gebal overrides the entrypoint with its immutable controller; no repository scripts.
ENTRYPOINT ["/usr/bin/python3"]
