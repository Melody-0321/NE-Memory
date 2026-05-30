/**
 * vault/schema.js — 状态 Schema 校验
 *
 * 替代 Python 端的 Pydantic 校验。
 * Schema 定义了 LLM 可以修改的字段及其类型/约束。
 */
export function resolvePath(schema, path) {
    if (!schema) return null;
    const parts = path.split('.');
    let current = schema;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!current) return null;
        if (current.type === 'object' && current.fields) {
            if (current.fields[part]) {
                current = current.fields[part];
            } else if (current.fields['*']) {
                current = current.fields['*'];
            } else {
                return null;
            }
        } else if (current.type === 'object' && current.schema) {
            if (current.schema && current.schema.fields) {
                if (current.schema.fields[part]) {
                    current = current.schema.fields[part];
                } else if (current.schema.fields['*']) {
                    current = current.schema.fields['*'];
                } else {
                    return null;
                }
            } else {
                return null;
            }
        } else {
            return null;
        }
    }
    return current;
}

export function validateChange(schema, path, value) {
    const fieldSchema = resolvePath(schema, path);
    if (!fieldSchema) {
        return { ok: false, error: 'Field not in schema: ' + path };
    }
    if (!validateType(value, fieldSchema)) {
        return { ok: false, error: 'Type mismatch for ' + path + ': expected ' + fieldSchema.type };
    }
    if (!validateConstraints(value, fieldSchema)) {
        return { ok: false, error: 'Constraint violation for ' + path };
    }
    return { ok: true };
}

export function validateChanges(schema, changes) {
    const validated = {};
    const rejected = [];
    Object.keys(changes).forEach(path => {
        const result = validateChange(schema, path, changes[path]);
        if (result.ok) {
            validated[path] = changes[path];
        } else {
            rejected.push({ path, error: result.error });
        }
    });
    return { validated, rejected };
}

function validateType(value, fieldSchema) {
    const type = fieldSchema.type;
    if (type === 'string') return typeof value === 'string';
    if (type === 'number') return typeof value === 'number';
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'enum') {
        return Array.isArray(fieldSchema.values) && fieldSchema.values.includes(value);
    }
    if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
    return true;
}

function validateConstraints(value, fieldSchema) {
    if (fieldSchema.type === 'string' && fieldSchema.max_length) {
        if (typeof value === 'string' && value.length > fieldSchema.max_length) return false;
    }
    if (fieldSchema.type === 'number') {
        if (fieldSchema.min !== undefined && value < fieldSchema.min) return false;
        if (fieldSchema.max !== undefined && value > fieldSchema.max) return false;
    }
    return true;
}

export function formatStateSummary(state, schema) {
    if (!schema) {
        try { return JSON.stringify(state); } catch (e) { return ''; }
    }
    const lines = [];
    const walk = (obj, prefix, sch) => {
        if (!sch || sch.type !== 'object') return;
        const fields = sch.fields || {};
        Object.keys(obj || {}).forEach(key => {
            const fieldSch = fields[key] || fields['*'];
            const fullPath = prefix ? prefix + '.' + key : key;
            const val = obj[key];
            if (fieldSch && fieldSch.type === 'object' && typeof val === 'object' && !Array.isArray(val)) {
                walk(val, fullPath, fieldSch);
            } else {
                const display = val === null || val === undefined ? '-' : String(val).substring(0, 40);
                lines.push(fullPath + '=' + display);
            }
        });
    };
    walk(state, '', schema);
    return lines.join(', ');
}

export function applyStateChanges(state, validatedChanges) {
    const newState = JSON.parse(JSON.stringify(state || {}));
    Object.keys(validatedChanges).forEach(path => {
        const parts = path.split('.');
        let current = newState;
        for (let i = 0; i < parts.length - 1; i++) {
            if (current[parts[i]] === undefined || current[parts[i]] === null) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        const lastKey = parts[parts.length - 1];
        if (validatedChanges[path] === '__DELETE__') {
            delete current[lastKey];
        } else {
            current[lastKey] = validatedChanges[path];
        }
    });
    return newState;
}
