use serde_json::Value;
use std::collections::HashSet;

const KEYWORDS: &[&str] = &[
    "$schema",
    "title",
    "description",
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "enum",
    "const",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "oneOf",
    "anyOf",
    "allOf",
];

pub fn validate_schema(schema: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    check_schema(schema, "#", 0, &mut errors);
    errors
}

pub fn validate_instance(schema: &Value, value: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    check_value(schema, value, "", &mut errors);
    errors
}

fn check_schema(schema: &Value, path: &str, depth: usize, errors: &mut Vec<String>) {
    if depth > 32 {
        errors.push(format!("{path}: profundidade maxima excedida."));
        return;
    }
    let Some(object) = schema.as_object() else {
        errors.push(format!("{path}: o schema deve ser um objeto."));
        return;
    };
    for key in object.keys() {
        if !KEYWORDS.contains(&key.as_str()) {
            errors.push(format!("{path}/{key}: keyword nao suportada."));
        }
    }
    for keyword in ["$schema", "title", "description"] {
        if object.get(keyword).is_some_and(|value| !value.is_string()) {
            errors.push(format!("{path}/{keyword}: deve ser texto."));
        }
    }
    if let Some(types) = object.get("type") {
        let valid = types.as_str().is_some_and(valid_type)
            || types.as_array().is_some_and(|items| {
                !items.is_empty()
                    && items
                        .iter()
                        .all(|item| item.as_str().is_some_and(valid_type))
            });
        if !valid {
            errors.push(format!("{path}/type: tipo invalido."));
        }
    }
    if let Some(properties) = object.get("properties") {
        match properties.as_object() {
            Some(properties) => {
                for (name, child) in properties {
                    check_schema(
                        child,
                        &format!("{path}/properties/{}", escape(name)),
                        depth + 1,
                        errors,
                    );
                }
            }
            None => errors.push(format!("{path}/properties: deve ser objeto.")),
        }
    }
    if let Some(required) = object.get("required") {
        let mut unique = HashSet::new();
        if !required.as_array().is_some_and(|items| {
            items.iter().all(|item| {
                item.as_str()
                    .is_some_and(|name| !name.is_empty() && unique.insert(name))
            })
        }) {
            errors.push(format!("{path}/required: nomes invalidos ou duplicados."));
        }
    }
    if let Some(additional) = object.get("additionalProperties") {
        if additional.is_object() {
            check_schema(
                additional,
                &format!("{path}/additionalProperties"),
                depth + 1,
                errors,
            );
        } else if !additional.is_boolean() {
            errors.push(format!("{path}/additionalProperties: valor invalido."));
        }
    }
    if let Some(items) = object.get("items") {
        check_schema(items, &format!("{path}/items"), depth + 1, errors);
    }
    if object
        .get("enum")
        .is_some_and(|value| !value.as_array().is_some_and(|items| !items.is_empty()))
    {
        errors.push(format!("{path}/enum: deve ser lista nao vazia."));
    }
    for keyword in ["minimum", "maximum"] {
        if object.get(keyword).is_some_and(|value| !value.is_number()) {
            errors.push(format!("{path}/{keyword}: deve ser numero."));
        }
    }
    if let (Some(minimum), Some(maximum)) = (
        object.get("minimum").and_then(Value::as_f64),
        object.get("maximum").and_then(Value::as_f64),
    ) {
        if minimum > maximum {
            errors.push(format!("{path}: minimum nao pode ser maior que maximum."));
        }
    }
    for keyword in ["minItems", "maxItems", "minLength", "maxLength"] {
        if object
            .get(keyword)
            .is_some_and(|value| value.as_u64().is_none())
        {
            errors.push(format!("{path}/{keyword}: deve ser inteiro nao negativo."));
        }
    }
    for (minimum, maximum) in [("minItems", "maxItems"), ("minLength", "maxLength")] {
        if let (Some(minimum_value), Some(maximum_value)) = (
            object.get(minimum).and_then(Value::as_u64),
            object.get(maximum).and_then(Value::as_u64),
        ) {
            if minimum_value > maximum_value {
                errors.push(format!(
                    "{path}: {minimum} nao pode ser maior que {maximum}."
                ));
            }
        }
    }
    for keyword in ["oneOf", "anyOf", "allOf"] {
        if let Some(branches) = object.get(keyword) {
            match branches.as_array().filter(|items| !items.is_empty()) {
                Some(branches) => {
                    for (index, branch) in branches.iter().enumerate() {
                        check_schema(
                            branch,
                            &format!("{path}/{keyword}/{index}"),
                            depth + 1,
                            errors,
                        );
                    }
                }
                None => errors.push(format!("{path}/{keyword}: deve ser lista nao vazia.")),
            }
        }
    }
}

fn check_value(schema: &Value, value: &Value, path: &str, errors: &mut Vec<String>) {
    let Some(object) = schema.as_object() else {
        errors.push("#: schema interno invalido.".to_string());
        return;
    };
    if let Some(types) = object.get("type") {
        let matches = types.as_str().is_some_and(|kind| matches_type(kind, value))
            || types.as_array().is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.as_str().is_some_and(|kind| matches_type(kind, value)))
            });
        if !matches {
            errors.push(format!("{}: tipo incompativel.", shown(path)));
            return;
        }
    }
    if object
        .get("enum")
        .and_then(Value::as_array)
        .is_some_and(|items| !items.contains(value))
    {
        errors.push(format!("{}: valor fora do enum.", shown(path)));
    }
    if object
        .get("const")
        .is_some_and(|expected| expected != value)
    {
        errors.push(format!("{}: valor diferente do const.", shown(path)));
    }
    if let Some(map) = value.as_object() {
        let properties = object.get("properties").and_then(Value::as_object);
        if let Some(required) = object.get("required").and_then(Value::as_array) {
            for name in required.iter().filter_map(Value::as_str) {
                if !map.contains_key(name) {
                    errors.push(format!(
                        "{}/{}: campo obrigatorio ausente.",
                        path,
                        escape(name)
                    ));
                }
            }
        }
        for (name, child) in map {
            let child_path = format!("{}/{}", path, escape(name));
            if let Some(child_schema) = properties.and_then(|items| items.get(name)) {
                check_value(child_schema, child, &child_path, errors);
            } else if let Some(additional) = object.get("additionalProperties") {
                if additional == &Value::Bool(false) {
                    errors.push(format!("{child_path}: campo adicional nao permitido."));
                } else if additional.is_object() {
                    check_value(additional, child, &child_path, errors);
                }
            }
        }
    }
    if let Some(items) = value.as_array() {
        check_size(object, "minItems", "maxItems", items.len(), path, errors);
        if let Some(item_schema) = object.get("items") {
            for (index, item) in items.iter().enumerate() {
                check_value(item_schema, item, &format!("{path}/{index}"), errors);
            }
        }
    }
    if let Some(text) = value.as_str() {
        check_size(
            object,
            "minLength",
            "maxLength",
            text.chars().count(),
            path,
            errors,
        );
    }
    if let Some(number) = value.as_f64() {
        if object
            .get("minimum")
            .and_then(Value::as_f64)
            .is_some_and(|min| number < min)
        {
            errors.push(format!("{}: numero abaixo do minimo.", shown(path)));
        }
        if object
            .get("maximum")
            .and_then(Value::as_f64)
            .is_some_and(|max| number > max)
        {
            errors.push(format!("{}: numero acima do maximo.", shown(path)));
        }
    }
    composition(object, "allOf", value, path, errors, |count, total| {
        count == total
    });
    composition(object, "anyOf", value, path, errors, |count, _| count > 0);
    composition(object, "oneOf", value, path, errors, |count, _| count == 1);
}

fn composition(
    object: &serde_json::Map<String, Value>,
    keyword: &str,
    value: &Value,
    path: &str,
    errors: &mut Vec<String>,
    accepts: impl Fn(usize, usize) -> bool,
) {
    let Some(branches) = object.get(keyword).and_then(Value::as_array) else {
        return;
    };
    let count = branches
        .iter()
        .filter(|branch| validate_instance(branch, value).is_empty())
        .count();
    if !accepts(count, branches.len()) {
        errors.push(format!("{}: nao satisfaz {keyword}.", shown(path)));
    }
}

fn check_size(
    object: &serde_json::Map<String, Value>,
    minimum: &str,
    maximum: &str,
    size: usize,
    path: &str,
    errors: &mut Vec<String>,
) {
    if object
        .get(minimum)
        .and_then(Value::as_u64)
        .is_some_and(|min| size < min as usize)
    {
        errors.push(format!("{}: tamanho abaixo de {minimum}.", shown(path)));
    }
    if object
        .get(maximum)
        .and_then(Value::as_u64)
        .is_some_and(|max| size > max as usize)
    {
        errors.push(format!("{}: tamanho acima de {maximum}.", shown(path)));
    }
}

fn valid_type(kind: &str) -> bool {
    matches!(
        kind,
        "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"
    )
}

fn matches_type(kind: &str, value: &Value) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "boolean" => value.is_boolean(),
        "null" => value.is_null(),
        _ => false,
    }
}

fn escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

fn shown(path: &str) -> &str {
    if path.is_empty() {
        "/"
    } else {
        path
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_instance, validate_schema};
    use serde_json::json;

    #[test]
    fn reports_the_exact_pointer_for_an_incompatible_value() {
        let schema = json!({
            "type":"object",
            "properties":{"status":{"type":"string"}},
            "required":["status"],
            "additionalProperties":false
        });
        assert!(validate_schema(&schema).is_empty());
        assert_eq!(
            validate_instance(&schema, &json!({"status":3})),
            vec!["/status: tipo incompativel."]
        );
    }

    #[test]
    fn rejects_unsupported_keywords_instead_of_ignoring_them() {
        assert_eq!(
            validate_schema(&json!({"type":"object","$ref":"https://example.test/a"})),
            vec!["#/$ref: keyword nao suportada."]
        );
    }

    #[test]
    fn rejects_contradictory_numeric_and_size_bounds() {
        let errors = validate_schema(&json!({
            "type":"object",
            "properties":{
                "text":{"type":"string","minLength":10,"maxLength":1},
                "score":{"type":"number","minimum":10,"maximum":1},
                "items":{"type":"array","minItems":5,"maxItems":2}
            }
        }));

        assert!(errors
            .iter()
            .any(|error| error.contains("/text: minLength nao pode ser maior que maxLength")));
        assert!(errors
            .iter()
            .any(|error| error.contains("/score: minimum nao pode ser maior que maximum")));
        assert!(errors
            .iter()
            .any(|error| error.contains("/items: minItems nao pode ser maior que maxItems")));
    }

    #[test]
    fn rejects_non_textual_schema_metadata() {
        assert_eq!(
            validate_schema(&json!({
                "$schema": 3,
                "title": false,
                "description": []
            })),
            vec![
                "#/$schema: deve ser texto.",
                "#/title: deve ser texto.",
                "#/description: deve ser texto."
            ]
        );
    }
}
