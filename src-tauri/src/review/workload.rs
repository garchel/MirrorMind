use super::session::interval_days_for_retention;
use serde::Serialize;

/// Estimativa de carga de uma politica de revisao para uma nota tipica,
/// calculada por simulacao deterministica (sem depender das notas reais do
/// vault). Serve para calibrar os valores da politica: retencao-alvo,
/// intervalos e primeira revisao.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkloadEstimate {
    /// Revisoes previstas nos primeiros 30 dias (incluindo a primeira).
    pub reviews_first_30_days: u64,
    /// Revisoes previstas no primeiro ano (incluindo a primeira).
    pub reviews_first_year: u64,
    /// Intervalo, em dias, entre revisoes ao fim do primeiro ano: o ritmo em
    /// que a politica se estabiliza depois que a memoria amadurece (ou o
    /// primeiro intervalo, quando nenhuma revisao ocorre dentro do ano).
    pub steady_interval_days: u64,
}

/// Simula o espacamento de uma nota tipica sob a politica dada, supondo
/// resultados `bom` em recall livre (a curva media de um aluno consistente):
/// a primeira revisao acontece no primeiro intervalo da politica e cada acerto
/// dobra a estabilidade DSR/FSRS, com a proxima revisao no ponto em que a
/// retencao decai ate o alvo configurado — exatamente a mesma curva de
/// esquecimento usada no reagendamento real (`interval_days_for_retention`).
/// Os limites minimo e maximo da politica sao respeitados em cada passo.
pub fn estimate_policy_workload(
    first_review_interval_days: u64,
    target_retention: f64,
    min_interval_days: u64,
    max_interval_days: u64,
) -> WorkloadEstimate {
    let mut day: f64 = first_review_interval_days as f64;
    let mut reviews_first_30_days = 0u64;
    let mut reviews_first_year = 0u64;
    let mut steady_interval_days = first_review_interval_days;
    if day <= 30.0 {
        reviews_first_30_days += 1;
    }
    if day <= 365.0 {
        reviews_first_year += 1;
    }
    // Estabilidade apos o primeiro acerto bom em recall livre (peso 1.0).
    let mut stability_days = 7.0;
    while day <= 365.0 {
        let interval = interval_days_for_retention(
            stability_days,
            target_retention,
            min_interval_days,
            max_interval_days,
        );
        steady_interval_days = interval;
        day += interval as f64;
        if day <= 365.0 {
            reviews_first_year += 1;
            if day <= 30.0 {
                reviews_first_30_days += 1;
            }
        }
        stability_days *= 2.0;
        // Guarda de seguranca: a estabilidade dobra a cada acerto, entao a
        // simulacao converge rapidamente para o intervalo maximo.
        if stability_days > 1e9 {
            break;
        }
    }
    WorkloadEstimate {
        reviews_first_30_days,
        reviews_first_year,
        steady_interval_days,
    }
}

#[cfg(test)]
mod tests {
    use super::estimate_policy_workload;

    #[test]
    fn intensive_policy_reviews_often_and_saturates_at_the_maximum_interval() {
        // Intensiva: primeira revisao em 1 dia, retencao 90%, maximo 90 dias.
        let estimate = estimate_policy_workload(1, 0.9, 1, 90);
        assert_eq!(estimate.reviews_first_30_days, 3);
        assert_eq!(estimate.reviews_first_year, 7);
        assert_eq!(estimate.steady_interval_days, 90);
    }

    #[test]
    fn light_policy_reviews_rarely() {
        // Leve: primeira revisao em 7 dias, retencao 70%, maximo 730 dias.
        let estimate = estimate_policy_workload(7, 0.7, 3, 730);
        assert_eq!(estimate.reviews_first_30_days, 1);
        assert_eq!(estimate.reviews_first_year, 4);
        assert_eq!(estimate.steady_interval_days, 249);
    }

    #[test]
    fn higher_retention_target_means_more_reviews() {
        let relaxed = estimate_policy_workload(2, 0.7, 1, 365);
        let strict = estimate_policy_workload(2, 0.95, 1, 365);
        assert!(strict.reviews_first_30_days > relaxed.reviews_first_30_days);
        assert!(strict.reviews_first_year >= relaxed.reviews_first_year);
        assert!(strict.steady_interval_days < relaxed.steady_interval_days);
    }

    #[test]
    fn a_first_review_beyond_the_year_produces_no_reviews_within_it() {
        let estimate = estimate_policy_workload(730, 0.8, 1, 3650);
        assert_eq!(estimate.reviews_first_30_days, 0);
        assert_eq!(estimate.reviews_first_year, 0);
        assert_eq!(estimate.steady_interval_days, 730);
    }

    #[test]
    fn the_minimum_interval_never_allows_more_than_one_review_per_day() {
        let estimate = estimate_policy_workload(1, 0.99, 1, 30);
        assert!(estimate.reviews_first_30_days <= 30);
        assert!(estimate.steady_interval_days >= 1);
    }
}
