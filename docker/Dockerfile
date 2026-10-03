# Offline assembly of verified Linux amd64 tools. See docs/sandbox.md.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
COPY wheels/ /tmp/wheels/
COPY requirements.lock /tmp/requirements.lock
RUN python3 -m pip install --no-index --require-hashes --find-links=/tmp/wheels -r /tmp/requirements.lock \
    && ln -sf /usr/local/bin/python3 /usr/bin/python3 \
    && rm -rf /tmp/wheels
# Install the verified compiler AFTER solc-select, which otherwise replaces it.
COPY forge solc /usr/local/bin/
RUN chmod 0755 /usr/local/bin/forge /usr/local/bin/solc \
    && forge --version && slither --version && solc --version
USER 65534:65534
WORKDIR /work
ENTRYPOINT ["/usr/bin/python3"]
