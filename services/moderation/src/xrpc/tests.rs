use std::{sync::Arc, time::Duration};

use futures::{SinkExt, StreamExt};
use serde_json::Value;
use sqlx::PgPool;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::broadcast,
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};

use crate::{
    build_router,
    db::{LabelDb, LABEL_WRITE_LOCK},
    labels::Label,
    AppState,
};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Server {
    url: String,
    task: JoinHandle<()>,
    db: Arc<LabelDb>,
    wake: broadcast::Sender<(i64, Label)>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn server(pool: PgPool) -> Server {
    let db = Arc::new(LabelDb::from_test_pool(pool));
    db.migrate().await.unwrap();
    let (wake, _) = broadcast::channel(1);
    let state = AppState {
        audd_api_token: String::new(),
        audd_api_url: String::new(),
        db: Some(db.clone()),
        signer: None,
        label_tx: Some(wake.clone()),
        claude: None,
    };
    let app = build_router(state, Some("test-token".into()));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Server {
        url: format!("ws://{address}/xrpc/com.atproto.label.subscribeLabels"),
        task,
        db,
        wake,
    }
}

fn label(key: usize) -> Label {
    Label::new(
        "did:plc:labeler",
        format!("at://did:plc:artist/fm.plyr.track/{key}"),
        "sexual",
    )
}

async fn socket(server: &Server, cursor: i64) -> Socket {
    connect_async(format!("{}?cursor={cursor}", server.url))
        .await
        .unwrap()
        .0
}

async fn event(socket: &mut Socket) -> Value {
    let message = timeout(Duration::from_secs(35), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    serde_json::from_str(message.to_text().unwrap()).unwrap()
}

#[sqlx::test]
async fn replays_every_page_and_ignores_broadcast_payload_order(pool: PgPool) {
    let server = server(pool).await;
    for key in 1..=1005 {
        assert_eq!(
            server.db.store_label(&label(key)).await.unwrap(),
            key as i64
        );
    }
    let mut socket = socket(&server, 0).await;
    for seq in 1..=1005 {
        let received = event(&mut socket).await;
        assert_eq!(received["seq"], seq);
        assert_eq!(received["labels"][0]["uri"], label(seq).uri);
    }
    for _ in 0..100 {
        server.wake.send((99_999, label(99_999))).unwrap();
    }
    assert!(timeout(Duration::from_millis(150), socket.next())
        .await
        .is_err());
    let first = server.db.store_label(&label(1006)).await.unwrap();
    let second = server.db.store_label(&label(1007)).await.unwrap();
    server.wake.send((second, label(1007))).unwrap();
    server.wake.send((first, label(1006))).unwrap();
    assert_eq!(event(&mut socket).await["seq"], first);
    assert_eq!(event(&mut socket).await["seq"], second);
    socket.close(None).await.unwrap();
    let mut resumed = connect_async(format!("{}?cursor=1006", server.url))
        .await
        .unwrap()
        .0;
    assert_eq!(event(&mut resumed).await["seq"], second);
    resumed.close(None).await.unwrap();
}

#[sqlx::test]
async fn catches_up_without_any_broadcast(pool: PgPool) {
    let server = server(pool.clone()).await;
    server.db.store_label(&label(1)).await.unwrap();
    let mut socket = socket(&server, 0).await;
    assert_eq!(event(&mut socket).await["seq"], 1);
    socket.send(Message::Ping(vec![1, 2, 3])).await.unwrap();
    assert_eq!(
        socket.next().await.unwrap().unwrap(),
        Message::Pong(vec![1, 2, 3])
    );
    let other_writer = LabelDb::from_test_pool(pool);
    let seq = other_writer.store_label(&label(2)).await.unwrap();
    assert_eq!(event(&mut socket).await["seq"], seq);
    socket.close(None).await.unwrap();
}

#[sqlx::test]
async fn rejects_invalid_cursors_and_starts_new_subscribers_at_head(pool: PgPool) {
    let server = server(pool).await;
    server.db.store_label(&label(1)).await.unwrap();
    for cursor in [-1, 2] {
        let result = connect_async(format!("{}?cursor={cursor}", server.url)).await;
        let error = result.unwrap_err();
        match error {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status(), 400)
            }
            other => panic!("unexpected error: {other}"),
        }
    }
    let mut socket = connect_async(&server.url).await.unwrap().0;
    socket.send(Message::Ping(vec![])).await.unwrap();
    assert_eq!(socket.next().await.unwrap().unwrap(), Message::Pong(vec![]));
    let seq = server.db.store_label(&label(2)).await.unwrap();
    server.wake.send((seq, label(2))).unwrap();
    assert_eq!(event(&mut socket).await["seq"], seq);
    socket.close(None).await.unwrap();
}

#[sqlx::test]
async fn label_sequence_allocation_waits_for_prior_writer_commit(pool: PgPool) {
    let db = Arc::new(LabelDb::from_test_pool(pool.clone()));
    db.migrate().await.unwrap();
    let mut prior = pool.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(LABEL_WRITE_LOCK)
        .execute(&mut *prior)
        .await
        .unwrap();
    let second_db = db.clone();
    let mut second = tokio::spawn(async move { second_db.store_label(&label(2)).await.unwrap() });
    assert!(timeout(Duration::from_millis(100), &mut second)
        .await
        .is_err());
    assert_eq!(db.get_latest_seq().await.unwrap(), 0);
    let first: i64 = sqlx::query_scalar("INSERT INTO labels (src, uri, val, cts, sig) VALUES ('did:plc:labeler', 'at://did:plc:artist/fm.plyr.track/1', 'sexual', now(), ''::bytea) RETURNING seq").fetch_one(&mut *prior).await.unwrap();
    prior.commit().await.unwrap();
    let second = timeout(Duration::from_secs(5), second)
        .await
        .unwrap()
        .unwrap();
    assert!(first < second);
    let rows = db.get_labels_since(0, 10).await.unwrap();
    assert_eq!(
        rows.iter().map(|row| row.seq).collect::<Vec<_>>(),
        vec![first, second]
    );
}
