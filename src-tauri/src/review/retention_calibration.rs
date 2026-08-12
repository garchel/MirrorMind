//! Calibracao deterministica do limiar de fragilidade da retencao.
//!
//! O dashboard e o relatorio de retencao contam unidades como *frageis* quando
//! a recuperabilidade efetiva (a curva de esquecimento do reagendamento, com
//! `FACTOR 19/81` e `DECAY -0.5`) fica abaixo de um limiar. O limiar provisorio
//! era um valor absoluto de 0.6; este modulo calibra esse numero por simulacao
//! deterministica da curva e mostra por que o limiar absoluto era inconsistente
//! entre politicas — e o que o limiar relativo corrige.
//!
//! # Forma fechada da curva
//!
//! A curva de esquecimento `R(d) = (1 + FACTOR * d / S)^DECAY`, com
//! `DECAY = -0.5` e `FACTOR = 19/81`, tem inversa fechada: o intervalo que leva
//! a retencao de `1.0` ate o alvo `T` e `I = S / FACTOR * (T^-2 - 1)` (a mesma
//! formula usada no reagendamento real, `interval_days_for_retention`). Como
//! `FACTOR * I / S = T^-2 - 1`, a retencao depois de `k` intervalos de revisao
//! perdidos (sem revisar) e:
//!
//! `R(k * I) = (1 + k * (T^-2 - 1))^(-0.5)`
//!
//! independente da estabilidade `S` — so depende do alvo `T` e de quantos
//! intervalos foram perdidos.
//!
//! # Resultado da calibracao
//!
//! Com o limiar absoluto de 0.6, o numero de intervalos perdidos ate uma
//! unidade ser contada como fragil varia muito com a politica:
//!
//! | Retencao-alvo | Intervalos perdidos ate cruzar 0.6 |
//! | --- | --- |
//! | 70% (Leve) | 1.71 |
//! | 80% (Equilibrada) | 3.16 |
//! | 90% (Intensiva) | 7.58 |
//!
//! Ou seja: 0.6 e severo demais para politicas leves (flagia apos ~2 intervalos
//! perdidos) e leniente demais para politicas intensivas (uma unidade de 90%
//! so fica fragil apos ~7 intervalos perdidos — um usuario muito atrasado
//! apareceria com zero unidades frageis). A calibracao substitui o absoluto por
//! um limiar **relativo ao alvo da nota**: fragil significa "perdeu cerca de
//! dois intervalos de revisao" (`MISSED_INTERVALS_FOR_FRAGILE = 2.0`), o que
//! faz o sinal significar a mesma coisa em qualquer politica:
//!
//! | Retencao-alvo | Limiar de fragilidade (2 intervalos perdidos) |
//! | --- | --- |
//! | 70% (Leve) | 0.570 |
//! | 80% (Equilibrada) | 0.686 |
//! | 90% (Intensiva) | 0.825 |
//! | 93% (tag com prazo) | 0.873 |
//!
//! O limiar relativo e usado no dashboard e no relatorio de retencao com o
//! alvo da politica efetiva de cada nota.

/// Intervalos de revisao perdidos que definem uma unidade como fragil. Dois
/// intervalos perdidos = duas revisoes programadas foram puladas, um sinal
/// forte de que a memoria ja decaiu alem do ponto em que qualquer politica
/// agendaria a proxima revisao.
pub const MISSED_INTERVALS_FOR_FRAGILE: f64 = 2.0;

/// Retencao efetiva depois de `missed_intervals` intervalos de revisao perdidos
/// (sem revisar) para uma politica com retencao-alvo `target_retention`.
/// Forma fechada da curva de esquecimento do reagendamento; independente da
/// estabilidade. Alvos invalidos retornam `0.0` (tratado como totalmente
/// esquecido em vez de propagar NaN).
pub fn retention_after_missed_intervals(target_retention: f64, missed_intervals: f64) -> f64 {
    if !(0.0..1.0).contains(&target_retention) {
        return 0.0;
    }
    let factor = target_retention.powi(-2) - 1.0;
    (1.0 + missed_intervals * factor).powf(-0.5).clamp(0.0, 1.0)
}

/// Quantos intervalos de revisao inteiros uma unidade perdeu quando sua
/// retencao efetiva cruza `threshold`, para uma politica com retencao-alvo
/// `target_retention`. Inversa da forma fechada: `k = ((1/T0)^2 - 1)/(T^-2 - 1)`.
/// Usada para documentar o comportamento de um limiar absoluto.
pub fn missed_intervals_to_cross(target_retention: f64, threshold: f64) -> f64 {
    if !(0.0..1.0).contains(&target_retention) || !(0.0..1.0).contains(&threshold) {
        return f64::INFINITY;
    }
    let denominator = target_retention.powi(-2) - 1.0;
    if denominator <= 0.0 {
        return f64::INFINITY;
    }
    (threshold.powi(-2) - 1.0) / denominator
}

/// Limiar de fragilidade calibrado para uma nota: a retencao efetiva em que a
/// unidade perdeu `MISSED_INTERVALS_FOR_FRAGILE` intervalos de revisao para o
/// alvo da politica efetiva da nota. Fragil significa a mesma coisa em
/// qualquer politica (cerca de duas revisoes programadas puladas).
pub fn fragile_threshold_for_target(target_retention: f64) -> f64 {
    retention_after_missed_intervals(target_retention, MISSED_INTERVALS_FOR_FRAGILE)
}

#[cfg(test)]
mod tests {
    use super::{
        fragile_threshold_for_target, missed_intervals_to_cross, retention_after_missed_intervals,
    };

    #[test]
    fn the_threshold_is_consistent_at_two_missed_intervals_for_every_target() {
        for target in [0.7, 0.8, 0.9, 0.93] {
            let threshold = fragile_threshold_for_target(target);
            let crossed = missed_intervals_to_cross(target, threshold);
            assert!(
                (crossed - 2.0).abs() < 1e-9,
                "threshold for target {target} must be crossed at 2 missed intervals, got {crossed}"
            );
        }
    }

    #[test]
    fn retention_decays_with_missed_intervals_and_depends_only_on_the_target() {
        // Mesmo alvo, estabilidades diferentes -> mesma retencao apos k
        // intervalos perdidos (a forma fechada cancela a estabilidade).
        assert!(
            (retention_after_missed_intervals(0.8, 1.0) - 0.8).abs() < 1e-9,
            "after one missed interval the retention is back at the target"
        );
        assert!((retention_after_missed_intervals(0.8, 2.0) - 0.685994).abs() < 1e-3);
        // Quanto maior o alvo, mais lenta a queda por intervalo: depois de 2
        // intervalos perdidos, uma politica de 90% ainda esta acima de 0.8.
        assert!(retention_after_missed_intervals(0.9, 2.0) > 0.8);
        assert!(retention_after_missed_intervals(0.7, 2.0) < 0.6);
    }

    #[test]
    fn the_absolute_060_threshold_was_inconsistent_across_policies() {
        // Evidencia da calibracao: o mesmo limiar absoluto 0.6 flagia uma
        // politica leve apos ~1.7 intervalos perdidos, mas uma intensiva so
        // apos ~7.6 — daí a substituicao pelo limiar relativo.
        let leve = missed_intervals_to_cross(0.7, 0.6);
        let equilibrada = missed_intervals_to_cross(0.8, 0.6);
        let intensiva = missed_intervals_to_cross(0.9, 0.6);
        assert!((leve - 1.71).abs() < 0.02, "leve: {leve}");
        assert!(
            (equilibrada - 3.16).abs() < 0.02,
            "equilibrada: {equilibrada}"
        );
        assert!((intensiva - 7.58).abs() < 0.02, "intensiva: {intensiva}");
        assert!(intensiva > equilibrada && equilibrada > leve);
    }

    #[test]
    fn the_relative_threshold_moves_with_the_target() {
        assert!(fragile_threshold_for_target(0.9) > fragile_threshold_for_target(0.8));
        assert!(fragile_threshold_for_target(0.8) > fragile_threshold_for_target(0.7));
        assert!(
            (fragile_threshold_for_target(0.93) - 0.873).abs() < 1e-3,
            "tag-deadline policy"
        );
    }

    #[test]
    fn invalid_targets_do_not_propagate_nan() {
        assert_eq!(retention_after_missed_intervals(1.0, 2.0), 0.0);
        assert_eq!(retention_after_missed_intervals(0.0, 2.0), 0.0);
        assert_eq!(missed_intervals_to_cross(1.0, 0.6), f64::INFINITY);
        assert_eq!(fragile_threshold_for_target(1.0), 0.0);
    }
}
