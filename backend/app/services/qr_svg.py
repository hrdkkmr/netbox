"""
Pure-Python offline ISO/IEC 18004 QR Code (Versions 1-4, Byte mode, ECC Level L)
SVG renderer with zero third-party dependencies and zero Internet requirements.
Supports URLs up to 78 bytes (plenty for LAN URLs like http://192.168.137.1:8000/).
"""

from typing import List, Optional, Tuple

# (version, size, data_codewords, ec_codewords, alignment_centers)
_QR_SPECS: List[Tuple[int, int, int, int, List[int]]] = [
    (1, 21, 19, 7, []),
    (2, 25, 34, 10, [6, 18]),
    (3, 29, 55, 15, [6, 22]),
    (4, 33, 80, 20, [6, 26]),
]

# GF(256) log / antilog tables with primitive polynomial 0x11d
_GF_EXP = [0] * 512
_GF_LOG = [0] * 256


def _init_gf() -> None:
    x = 1
    for i in range(255):
        _GF_EXP[i] = x
        _GF_LOG[x] = i
        x <<= 1
        if x & 0x100:
            x ^= 0x11D
    for i in range(255, 512):
        _GF_EXP[i] = _GF_EXP[i - 255]


_init_gf()


def _gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _GF_EXP[_GF_LOG[a] + _GF_LOG[b]]


def _rs_generator_poly(degree: int) -> List[int]:
    poly = [1]
    for i in range(degree):
        next_poly = [0] * (len(poly) + 1)
        factor = _GF_EXP[i]
        for j, coef in enumerate(poly):
            next_poly[j] ^= coef
            next_poly[j + 1] ^= _gf_mul(coef, factor)
        poly = next_poly
    return poly


def _rs_remainder(data: List[int], ec_count: int) -> List[int]:
    gen = _rs_generator_poly(ec_count)
    rem = list(data) + [0] * ec_count
    for i in range(len(data)):
        coef = rem[i]
        if coef != 0:
            for j in range(1, len(gen)):
                rem[i + j] ^= _gf_mul(gen[j], coef)
    return rem[len(data):]


def _select_spec(payload_len: int) -> Optional[Tuple[int, int, int, int, List[int]]]:
    # Byte mode overhead: 4-bit mode (0100) + 8-bit length + 4-bit terminator = 16 bits (2 bytes)
    for spec in _QR_SPECS:
        if payload_len + 2 <= spec[2]:
            return spec
    return None


def _encode_data_codewords(payload: bytes, total_data_cw: int) -> List[int]:
    bits: List[int] = []

    def push(val: int, width: int) -> None:
        for shift in range(width - 1, -1, -1):
            bits.append((val >> shift) & 1)

    push(0b0100, 4)  # Byte mode
    push(len(payload), 8)
    for b in payload:
        push(b, 8)

    max_bits = total_data_cw * 8
    terminator = min(4, max_bits - len(bits))
    push(0, terminator)

    while len(bits) % 8 != 0:
        bits.append(0)

    codewords: List[int] = []
    for i in range(0, len(bits), 8):
        val = 0
        for bit in bits[i : i + 8]:
            val = (val << 1) | bit
        codewords.append(val)

    pad_bytes = [0xEC, 0x11]
    idx = 0
    while len(codewords) < total_data_cw:
        codewords.append(pad_bytes[idx % 2])
        idx += 1
    return codewords


def _build_qr_matrix(text: str) -> Optional[List[List[int]]]:
    payload = text.encode("utf-8")
    spec = _select_spec(len(payload))
    if spec is None:
        return None

    version, size, data_cw, ec_cw, align_centers = spec
    data = _encode_data_codewords(payload, data_cw)
    ecc = _rs_remainder(data, ec_cw)
    all_cw = data + ecc

    # Initialize matrix (-1 = empty, 0 = white, 1 = black) and function mask
    grid = [[-1 for _ in range(size)] for _ in range(size)]
    is_func = [[False for _ in range(size)] for _ in range(size)]

    def set_func(r: int, c: int, val: int) -> None:
        if 0 <= r < size and 0 <= c < size:
            grid[r][c] = val
            is_func[r][c] = True

    def draw_finder(top: int, left: int) -> None:
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                r, c = top + dr, left + dc
                if not (0 <= r < size and 0 <= c < size):
                    continue
                if dr in (-1, 7) or dc in (-1, 7):
                    set_func(r, c, 0)
                elif dr in (0, 6) or dc in (0, 6) or (2 <= dr <= 4 and 2 <= dc <= 4):
                    set_func(r, c, 1)
                else:
                    set_func(r, c, 0)

    draw_finder(0, 0)
    draw_finder(0, size - 7)
    draw_finder(size - 7, 0)

    # Alignment patterns
    for r_c in align_centers:
        for c_c in align_centers:
            if (r_c == 6 and c_c == 6) or (r_c == 6 and c_c == size - 7) or (r_c == size - 7 and c_c == 6):
                continue
            for dr in range(-2, 3):
                for dc in range(-2, 3):
                    val = 1 if max(abs(dr), abs(dc)) in (0, 2) else 0
                    set_func(r_c + dr, c_c + dc, val)

    # Timing patterns
    for i in range(8, size - 8):
        val = 1 if i % 2 == 0 else 0
        if not is_func[6][i]:
            set_func(6, i, val)
        if not is_func[i][6]:
            set_func(i, 6, val)

    # Dark module
    set_func(4 * version + 9, 8, 1)

    # Reserve format info areas (ECC L = 01, Mask 0 = 000 -> format bits 111011111000100)
    fmt_bits = 0b111011111000100
    for i in range(15):
        bit = (fmt_bits >> (14 - i)) & 1
        # Around top-left finder
        if i < 6:
            set_func(8, i, bit)
        elif i == 6:
            set_func(8, 7, bit)
        elif i == 7:
            set_func(8, 8, bit)
        elif i == 8:
            set_func(7, 8, bit)
        else:
            set_func(14 - i, 8, bit)

        # Second copy (bottom-left and top-right)
        if i < 7:
            set_func(size - 1 - i, 8, bit)
        else:
            set_func(8, size - 15 + i, bit)

    # Place data bits in zigzag columns with Mask 0: (r + c) % 2 == 0
    bit_stream: List[int] = []
    for cw in all_cw:
        for shift in range(7, -1, -1):
            bit_stream.append((cw >> shift) & 1)

    bit_idx = 0
    col = size - 1
    upward = True
    while col > 0:
        if col == 6:
            col -= 1
        rows = range(size - 1, -1, -1) if upward else range(size)
        for r in rows:
            for dc in (0, -1):
                c = col + dc
                if not is_func[r][c]:
                    bit = bit_stream[bit_idx] if bit_idx < len(bit_stream) else 0
                    bit_idx += 1
                    if (r + c) % 2 == 0:
                        bit ^= 1
                    grid[r][c] = bit
        col -= 2
        upward = not upward

    return grid


def generate_qr_svg(text: str, module_px: int = 5, quiet_zone: int = 2) -> Optional[str]:
    """
    Renders a deterministic, scannable inline SVG QR code for the given text.
    Returns None if text exceeds supported capacity (~78 UTF-8 bytes).
    """
    matrix = _build_qr_matrix(text)
    if matrix is None:
        return None

    n = len(matrix)
    total = (n + quiet_zone * 2) * module_px
    rects: List[str] = []
    for r in range(n):
        for c in range(n):
            if matrix[r][c] == 1:
                x = (c + quiet_zone) * module_px
                y = (r + quiet_zone) * module_px
                rects.append(f'<rect x="{x}" y="{y}" width="{module_px}" height="{module_px}"/>')

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} {total}" '
        f'width="{total}" height="{total}" role="img" aria-label="QR code for {text}">'
        f'<rect width="100%" height="100%" fill="#ffffff"/>'
        f'<g fill="#0f172a">{"".join(rects)}</g>'
        f"</svg>"
    )
