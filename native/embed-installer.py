"""Build-time only: pin reviewed Python and command payloads into native installer."""
from pathlib import Path
import base64
import hashlib
import json

root = Path(__file__).resolve().parent.parent
expected = {name: hashlib.sha256((root / source).read_bytes()).hexdigest()
            for name, source in (("new-cli", "battery.sh"), ("new-helper", "build/battery-native"))}
source = (root / "native/install.py").read_text().replace("EXPECTED = {}", "EXPECTED = " + repr(expected))
payload = source.encode()
(root / "build/installer-payload.swift").write_text(
    "import Foundation\nlet installerPayload = Data(base64Encoded: " + json.dumps(base64.b64encode(payload).decode()) + ")!\n" +
    "let payloadHash = " + json.dumps(hashlib.sha256(payload).hexdigest()) + "\n")
# Swift executable entrypoint must be named main.swift.
(root / "build/main.swift").write_bytes((root / "native/installer-main.swift").read_bytes())
