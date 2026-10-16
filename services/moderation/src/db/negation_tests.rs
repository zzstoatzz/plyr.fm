use chrono::{Duration, Utc};
use sqlx::PgPool;

use super::LabelDb;
use crate::labels::Label;

#[sqlx::test]
async fn reassertion_reopens_copyright_flags_in_every_reader(pool: PgPool) {
    let db = LabelDb::from_test_pool(pool);
    db.migrate().await.unwrap();
    let uri = "at://did:plc:artist/fm.plyr.track/reasserted".to_string();
    let uris = vec![uri.clone()];
    db.create_batch("reassertion", &uris, Some("test"))
        .await
        .unwrap();
    for (negated, expected_resolved) in [(false, false), (true, true), (false, false)] {
        let mut label = Label::new("did:plc:labeler", &uri, "copyright-violation");
        if negated {
            label = label.negated();
        }
        db.store_label(&label).await.unwrap();
        assert_eq!(
            db.get_negated_labels(&uris).await.unwrap().contains(&uri),
            expected_resolved
        );
        for flags in [
            db.get_pending_flags().await.unwrap(),
            db.get_batch_flags("reassertion").await.unwrap(),
        ] {
            assert!(!flags.is_empty());
            assert!(flags.iter().all(|flag| flag.resolved == expected_resolved));
        }
        assert_eq!(
            db.get_active_labels(&uris).await.unwrap().contains(&uri),
            !expected_resolved
        );
    }
}

#[sqlx::test]
async fn negations_do_not_override_other_sources_or_values(pool: PgPool) {
    let db = LabelDb::from_test_pool(pool);
    db.migrate().await.unwrap();
    let uri = "at://did:plc:artist/fm.plyr.track/scoped".to_string();
    let uris = vec![uri.clone()];
    db.store_label(&Label::new("did:plc:one", &uri, "copyright-violation"))
        .await
        .unwrap();
    db.store_label(&Label::new("did:plc:two", &uri, "copyright-violation").negated())
        .await
        .unwrap();
    db.store_label(&Label::new("did:plc:one", &uri, "sexual").negated())
        .await
        .unwrap();
    assert!(db.get_negated_labels(&uris).await.unwrap().is_empty());
    db.store_label(&Label::new("did:plc:one", &uri, "copyright-violation").negated())
        .await
        .unwrap();
    assert_eq!(db.get_negated_labels(&uris).await.unwrap(), uris);
    assert!(db.get_negated_labels(&[]).await.unwrap().is_empty());
}

#[sqlx::test]
async fn expired_latest_negation_does_not_restore_an_older_dismissal(pool: PgPool) {
    let db = LabelDb::from_test_pool(pool);
    db.migrate().await.unwrap();
    let uri = "at://did:plc:artist/fm.plyr.track/expired".to_string();
    let uris = vec![uri.clone()];
    let mut label = Label::new("did:plc:labeler", &uri, "copyright-violation").negated();
    db.store_label(&label).await.unwrap();
    assert_eq!(db.get_negated_labels(&uris).await.unwrap(), uris);
    label.exp = Some((Utc::now() - Duration::seconds(1)).to_rfc3339());
    db.store_label(&label).await.unwrap();
    assert!(db.get_negated_labels(&uris).await.unwrap().is_empty());
}
