#[test]
fn probe_score_debug() {
    let markdown = "# Fotossintese\n\nPlantas convertem energia luminosa em energia quimica.";
    eprintln!("MD UTF16 LEN: {}", markdown.encode_utf16().count());
    eprintln!("GAP LEN: {}", "energia luminosa".encode_utf16().count());
    let start = markdown.find("energia luminosa").unwrap();
    let start16 = markdown[..start].encode_utf16().count();
    eprintln!("GAP START UTF16: {start16}");
}
