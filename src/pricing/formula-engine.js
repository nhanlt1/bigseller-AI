const ALLOWED_IDENTIFIERS = new Set([
    'cost',
    'profitRate',
    'shopeeFee',
    'shippingSubsidy',
    'voucherRate',
]);
function tokenize(formula) {
    const tokens = [];
    let i = 0;
    const src = formula.replace(/\s+/g, '');
    while (i < src.length) {
        const ch = src[i];
        if (/[0-9.]/.test(ch)) {
            let num = ch;
            i++;
            while (i < src.length && /[0-9.]/.test(src[i])) {
                num += src[i++];
            }
            tokens.push({ type: 'number', value: Number(num) });
            continue;
        }
        if (/[a-zA-Z_]/.test(ch)) {
            let name = ch;
            i++;
            while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) {
                name += src[i++];
            }
            if (!ALLOWED_IDENTIFIERS.has(name)) {
                throw new Error(`Biến không hợp lệ: ${name}`);
            }
            tokens.push({ type: 'ident', name });
            continue;
        }
        if ('+-*/()'.includes(ch)) {
            if (ch === '(' || ch === ')') {
                tokens.push({ type: 'paren', value: ch });
            }
            else {
                tokens.push({ type: 'op', value: ch });
            }
            i++;
            continue;
        }
        throw new Error(`Ký tự không hợp lệ: ${ch}`);
    }
    return tokens;
}
function parseExpression(tokens, pos) {
    return parseAddSub(tokens, pos);
}
function parseAddSub(tokens, pos) {
    let left = parseMulDiv(tokens, pos);
    while (pos.i < tokens.length && tokens[pos.i].type === 'op') {
        const op = tokens[pos.i].value;
        if (op !== '+' && op !== '-')
            break;
        pos.i++;
        const right = parseMulDiv(tokens, pos);
        left = op === '+' ? left + right : left - right;
    }
    return left;
}
function parseMulDiv(tokens, pos) {
    let left = parseUnary(tokens, pos);
    while (pos.i < tokens.length && tokens[pos.i].type === 'op') {
        const op = tokens[pos.i].value;
        if (op !== '*' && op !== '/')
            break;
        pos.i++;
        const right = parseUnary(tokens, pos);
        if (op === '/' && right === 0) {
            throw new Error('Chia cho 0');
        }
        left = op === '*' ? left * right : left / right;
    }
    return left;
}
function parseUnary(tokens, pos) {
    if (pos.i < tokens.length && tokens[pos.i].type === 'op') {
        const op = tokens[pos.i].value;
        if (op === '+') {
            pos.i++;
            return parseUnary(tokens, pos);
        }
        if (op === '-') {
            pos.i++;
            return -parseUnary(tokens, pos);
        }
    }
    return parsePrimary(tokens, pos);
}
function parsePrimary(tokens, pos) {
    const token = tokens[pos.i];
    if (!token)
        throw new Error('Biểu thức không hợp lệ');
    if (token.type === 'number') {
        pos.i++;
        return token.value;
    }
    if (token.type === 'ident') {
        pos.i++;
        throw new Error(`Biến "${token.name}" phải được thay thế trước khi tính`);
    }
    if (token.type === 'paren' && token.value === '(') {
        pos.i++;
        const value = parseExpression(tokens, pos);
        const close = tokens[pos.i];
        if (!close || close.type !== 'paren' || close.value !== ')') {
            throw new Error('Thiếu dấu đóng ngoặc )');
        }
        pos.i++;
        return value;
    }
    throw new Error('Biểu thức không hợp lệ');
}
export function substituteVariables(formula, variables) {
    return formula.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (name) => {
        if (!(name in variables)) {
            throw new Error(`Biến không xác định: ${name}`);
        }
        return String(variables[name]);
    });
}
export function evaluateFormula(formula, variables) {
    const substituted = substituteVariables(formula, variables);
    const tokens = tokenize(substituted);
    const pos = { i: 0 };
    const result = parseExpression(tokens, pos);
    if (pos.i !== tokens.length) {
        throw new Error('Biểu thức còn token thừa');
    }
    if (!Number.isFinite(result)) {
        throw new Error('Kết quả không hợp lệ');
    }
    return result;
}
export function formatVnd(value) {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0,
    }).format(Math.round(value));
}
