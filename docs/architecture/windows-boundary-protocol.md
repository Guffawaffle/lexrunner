# Windows boundary negotiation codec

This implements the first wire-contract slice for ADR-011 / #890. It is a pure
codec and metadata comparison, not a launched broker, authenticated helper,
qualified boundary or new production route. The Windows resolver still reports
`helper_missing`. Existing #955 stable-file proof work is separate and untouched.

Each control frame contains a four-byte unsigned big-endian payload byte length
followed by UTF-8 canonical JSON using LexRunner's canonical serializer (sorted
object keys, two-space indentation and terminal newline). Payloads are limited to
4 KiB. The negotiation decoder retains fixed header/payload storage, accepts
fragmented or coalesced input and enforces a lifetime budget of 16 frames and
16 × (4 + 4096) bytes. It is for negotiation, not an unbounded operations stream.

The initial strict v1 message set is `hello` and `hello_result`. Both carry the
exact protocol version, request ID and a client-generated 256-bit nonce. The
response adds a fresh helper session nonce and reported artifact SHA-256,
architecture and process ID. Callers must generate nonces cryptographically;
the codec only validates their representation. Unknown fields, unsupported
versions, duplicate JSON keys, invalid UTF-8/BOM, noncanonical representations,
oversized frames and truncated EOF fail closed with fixed errors. Any decoding
failure is terminal. A failed coalesced push returns no messages from that push;
messages returned by earlier pushes remain historical input.

`assessWindowsBoundaryHello` compares the response's request/client nonce and
reported helper metadata with a specific caller-supplied launch record. Even a
match reports `verification: not_performed`. Matching claimed digests or PIDs is
not binary authentication, process ownership, release-signer trust, a self-probe
or proof that a nonce is fresh. No lease or filesystem capability is issued.

The [owned handshake probe](owned-windows-boundary-handshake.md) now exercises a
one-shot development child with private pipes, a deadline and explicit cleanup.
It remains non-authorizing and does not supply a production helper.

Production integration must bind these frames to owned inherited private pipes, verify
the actual helper artifact against independently trusted release metadata and
signer policy before launch, correlate replies with the actual child, enforce a
handshake deadline and one accepted handshake, and retain explicit cleanup
uncertainty. Root handles, operation capabilities, native conformance, package
distribution and resolver readiness remain separate implementation gates. Do not
promote either the codec or the development proof into a ready backend.
