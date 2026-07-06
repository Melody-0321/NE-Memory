// Retrieval metrics with graded relevance (0/1/2)

function _gain(score) {
  return score || 0;
}

export function precisionAtK(retrievedIds, groundTruth, k) {
  var count = 0;
  var limit = Math.min(k, retrievedIds.length);
  for (var i = 0; i < limit; i++) {
    if ((groundTruth[retrievedIds[i]] || 0) >= 1) count++;
  }
  return count / k;
}

export function recallAtK(retrievedIds, groundTruth, k) {
  var totalRelevant = 0;
  Object.keys(groundTruth).forEach(function(id) {
    if (groundTruth[id] >= 1) totalRelevant++;
  });
  if (totalRelevant === 0) return 1;

  var count = 0;
  var limit = Math.min(k, retrievedIds.length);
  for (var i = 0; i < limit; i++) {
    if ((groundTruth[retrievedIds[i]] || 0) >= 1) count++;
  }
  return count / totalRelevant;
}

export function ndcgAtK(retrievedIds, groundTruth, k) {
  var limit = Math.min(k, retrievedIds.length);

  var dcg = 0;
  for (var i = 0; i < limit; i++) {
    var g = _gain(groundTruth[retrievedIds[i]] || 0);
    dcg += g / Math.log2(i + 2);
  }

  var idealGains = [];
  Object.keys(groundTruth).forEach(function(id) {
    idealGains.push(_gain(groundTruth[id]));
  });
  idealGains.sort(function(a, b) { return b - a; });

  var idcg = 1e-9;
  for (var i = 0; i < Math.min(k, idealGains.length); i++) {
    idcg += idealGains[i] / Math.log2(i + 2);
  }

  return dcg / Math.max(idcg, 1e-9);
}

export function mrr(retrievedIds, groundTruth) {
  for (var i = 0; i < retrievedIds.length; i++) {
    if ((groundTruth[retrievedIds[i]] || 0) >= 2) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function hitAtK(retrievedIds, groundTruth, k) {
  var limit = Math.min(k, retrievedIds.length);
  for (var i = 0; i < limit; i++) {
    if ((groundTruth[retrievedIds[i]] || 0) >= 1) return 1;
  }
  return 0;
}

export function median(arr) {
  if (arr.length === 0) return 0;
  var sorted = arr.slice().sort(function(a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function avg(arr) {
  if (arr.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

export function precisionAtK_active(retrievedIds, groundTruth, activeEntities, entityToStmIds, k) {
  var activeStmIds = {};
  if (activeEntities) {
    activeEntities.forEach(function(name) {
      var stmIds = entityToStmIds[name] || [];
      stmIds.forEach(function(id) { activeStmIds[id] = true; });
    });
  }
  var total = 0;
  Object.keys(groundTruth).forEach(function(id) {
    if (groundTruth[id] >= 1 && activeStmIds[id]) total++;
  });
  if (total === 0) return 1;
  var count = 0;
  var limit = Math.min(k, retrievedIds.length);
  for (var i = 0; i < limit; i++) {
    if ((groundTruth[retrievedIds[i]] || 0) >= 1 && activeStmIds[retrievedIds[i]]) count++;
  }
  return count / k;
}

export function hitAtK_active(retrievedIds, groundTruth, activeEntities, entityToStmIds, k) {
  var activeStmIds = {};
  if (activeEntities) {
    activeEntities.forEach(function(name) {
      var stmIds = entityToStmIds[name] || [];
      stmIds.forEach(function(id) { activeStmIds[id] = true; });
    });
  }
  var limit = Math.min(k, retrievedIds.length);
  for (var i = 0; i < limit; i++) {
    if ((groundTruth[retrievedIds[i]] || 0) >= 1 && activeStmIds[retrievedIds[i]]) return 1;
  }
  return 0;
}

export function weightedScore(scores) {
  return 0.35 * scores.hit3 + 0.25 * scores.p5 + 0.20 * scores.ndcg10 + 0.10 * scores.r10 + 0.10 * scores.r20;
}
