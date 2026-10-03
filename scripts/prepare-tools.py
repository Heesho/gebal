#!/usr/bin/env python3
"""Prepare Gebal's pinned Linux amd64 image. Network is used only during preparation.
Never pass an assessed repository as --output. This script does not run an audit.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import urllib.request

BASE = 'python@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e'
FORGE_VERSION = '1.3.1'
FORGE_SHA = 'baad3e1b06d6f310d210c93e95258a03d923fe610f8d0742138f2245f94abd7c'
SOLC = {
    '0.8.26': ('0.8.26+commit.8a97fa7a', 'd5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef'),
    '0.8.28': ('0.8.28+commit.7893614a', '9a0fb7e0db2c0641dbae1c5cc645dc686820c83af516226abb1c0a2f76636f25'),
    '0.8.30': ('0.8.30+commit.73712a01', 'f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7'),
}


def download(url, expected):
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read(150 * 1024 * 1024 + 1)
    if len(data) > 150 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError('Release checksum mismatch: ' + url)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='New preparation directory, visible at the same path inside the local Docker VM')
    parser.add_argument('--compiler', choices=SOLC, default='0.8.28')
    args = parser.parse_args()
    host = os.environ.get('GEBAL_DOCKER_HOST', 'unix:///var/run/docker.sock')
    if not re.fullmatch(r'unix:///[^\s,?#]+', host) or '..' in host[7:].split('/'):
        raise ValueError('GEBAL_DOCKER_HOST must be an absolute local Unix socket')
    output = Path(args.output).expanduser().resolve()
    if ',' in str(output) or any(ord(c) < 32 for c in str(output)):
        raise ValueError('Unsupported preparation path')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    repo = Path(__file__).resolve().parents[1]
    for name in ['Dockerfile', 'requirements.lock']:
        shutil.copyfile(repo / 'docker' / name, output / name)
    (output / '.dockerignore').write_text('*\n!Dockerfile\n!requirements.lock\n!wheels/**\n!forge\n!solc\n')
    forge_url = f'https://github.com/foundry-rs/foundry/releases/download/v{FORGE_VERSION}/foundry_v{FORGE_VERSION}_linux_amd64.tar.gz'
    archive = download(forge_url, FORGE_SHA)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        member = tar.getmember('forge')
        if not member.isfile() or member.size > 150 * 1024 * 1024:
            raise RuntimeError('Invalid Forge archive member')
        (output / 'forge').write_bytes(tar.extractfile(member).read())
    release, checksum = SOLC[args.compiler]
    solc_url = 'https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/linux-amd64/solc-linux-amd64-v' + release
    (output / 'solc').write_bytes(download(solc_url, checksum))
    docker = ['docker', '--host', host]
    subprocess.run(docker + ['pull', '--platform=linux/amd64', BASE], check=True)
    # The only host mount is the new preparation directory; no assessed source or secrets.
    subprocess.run(docker + ['run', '--rm', '--platform=linux/amd64', '--mount', f'type=bind,src={output},dst=/prepare', BASE,
        'python', '-m', 'pip', 'download', '--only-binary=:all:', '--require-hashes', '--dest', '/prepare/wheels', '-r', '/prepare/requirements.lock'], check=True)
    tag = 'gebal-tools:' + args.compiler
    subprocess.run(docker + ['build', '--platform=linux/amd64', '--network=none', '--pull=false', '--build-arg', 'BASE_IMAGE=' + BASE, '-t', tag, str(output)], check=True)
    image = subprocess.check_output(docker + ['image', 'inspect', '--format', '{{.Id}}', tag], text=True).strip()
    manifest = {'platform': 'linux/amd64', 'base': BASE, 'image': image, 'forge': {'version': FORGE_VERSION, 'url': forge_url, 'sha256': FORGE_SHA}, 'solc': {'version': args.compiler, 'url': solc_url, 'sha256': checksum}, 'requirementsSha256': hashlib.sha256((output / 'requirements.lock').read_bytes()).hexdigest()}
    (output / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
