"""Ретроспективная кластеризация профилей клуба за сезон; не предматчевый признак."""
from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score, adjusted_rand_score
from sklearn.preprocessing import StandardScaler

from app.data import MODEL_DIR, frame, clean, connection, put_meta, club, RESULT_LABELS, METRIC_LABELS
from app.visuals import style_visuals
from app.coaching import opponent_snapshot

STYLE_FEATURES=['passes','directness','pass_accuracy','shots','shot_quality',
                'defensive_events','central_attack_share']


def train_styles():
    df=frame(); profiles=df.groupby('team_id')[STYLE_FEATURES].mean().sort_index()
    scaler=StandardScaler(); x=scaler.fit_transform(profiles)
    candidates=[]; fitted={}
    for k in range(2,6):
        model=KMeans(n_clusters=k,n_init=30,random_state=42).fit(x)
        sizes=np.bincount(model.labels_,minlength=k).tolist()
        s=float(silhouette_score(x,model.labels_))
        candidates.append({'k':k,'silhouette':s,'cluster_sizes':sizes,'eligible':min(sizes)>=3})
        fitted[k]=model
    eligible=[c for c in candidates if c['eligible']]
    selected=max(eligible or candidates,key=lambda c:c['silhouette'])
    model=fitted[selected['k']]
    rng=np.random.default_rng(42); stability=[]
    groups={tid:g for tid,g in df.groupby('team_id')}
    for _ in range(60):
        sampled=np.array([g[STYLE_FEATURES].iloc[rng.integers(0,len(g),len(g))].mean().values
                          for g in [groups[t] for t in profiles.index]])
        xx=scaler.transform(pd.DataFrame(sampled,columns=STYLE_FEATURES))
        labels=KMeans(n_clusters=selected['k'],n_init=10,random_state=42).fit_predict(xx)
        stability.append(adjusted_rand_score(model.labels_,labels))
    centers=scaler.inverse_transform(model.cluster_centers_)
    # Альтернативная единица наблюдения: неперекрывающийся блок из 6 матчей.
    # Повторения клуба остаются зависимыми, и мы не называем 120 блоков 120 независимыми командами.
    blocks=[]
    for tid,g in groups.items():
        for start in range(0,len(g)-5,6):
            blocks.append(g.iloc[start:start+6][STYLE_FEATURES].mean().to_dict())
    block_profiles=pd.DataFrame(blocks,columns=STYLE_FEATURES)
    block_scaler=StandardScaler(); bx=block_scaler.fit_transform(block_profiles)
    block_candidates=[]
    for k in range(2,6):
        bm=KMeans(n_clusters=k,n_init=30,random_state=42).fit(bx)
        sizes=np.bincount(bm.labels_,minlength=k).tolist()
        block_candidates.append({'k':k,'silhouette':float(silhouette_score(bx,bm.labels_)),
                                 'cluster_sizes':sizes,'eligible':min(sizes)>=6})
    block_best=max([c for c in block_candidates if c['eligible']] or block_candidates,key=lambda c:c['silhouette'])
    clusters=[]
    for label in range(selected['k']):
        z=model.cluster_centers_[label]; order=np.argsort(np.abs(z))[::-1][:2]
        traits=[{'metric':STYLE_FEATURES[i],'label':METRIC_LABELS[STYLE_FEATURES[i]],
                 'z_score':float(z[i]),'direction':'Выше среднего' if z[i]>0 else 'Ниже среднего'} for i in order]
        name='; '.join(('Высокий: ' if z[i]>0 else 'Низкий: ')+METRIC_LABELS[STYLE_FEATURES[i]].lower() for i in order)
        clusters.append({'cluster_id':label,'name':name,
                         'team_ids':profiles.index[model.labels_==label].astype(int).tolist(),
                         'center':dict(zip(STYLE_FEATURES,centers[label].tolist())),
                         'standardized_center':dict(zip(STYLE_FEATURES,z.tolist())),'traits':traits})
    artifact={'scaler':scaler,'model':model,'features':STYLE_FEATURES,'profiles':profiles,
              'labels':dict(zip(profiles.index.astype(int).tolist(),model.labels_.astype(int).tolist()))}
    MODEL_DIR.mkdir(exist_ok=True); joblib.dump(artifact,MODEL_DIR/'styles.joblib',compress=3)
    result=clean({'observational_unit':'Средний событийный профиль клуба за полный сезон',
        'sample_size':len(profiles),'features':[{'id':k,'label':METRIC_LABELS[k]} for k in STYLE_FEATURES],
        'candidates':candidates,'selected_k':selected['k'],'silhouette':selected['silhouette'],
        'selection_rule':'Максимум силуэта среди k=2..5 с минимум тремя клубами в каждом кластере; при отсутствии — максимум с предупреждением.',
        'minimum_cluster_constraint_met':bool(eligible),
        'reliability_warning':'У выбранного сезонного решения есть группа менее трёх клубов; это редкий событийный профиль, а не надёжно установленный тактический тип.' if not eligible else 'Даже при достаточном размере групп вывод остаётся разведочным.',
        'alternative_block_evaluation':{'unit':'Неперекрывающиеся блоки по 6 матчей внутри клуба; последние 2 матча каждого клуба не входят только в эту диагностику.',
            'profiles':len(blocks),'clubs':len(profiles),'candidates':block_candidates,'selected_k':block_best['k'],
            'interpretation':'Альтернативная проверка масштаба наблюдения. Для итоговых результатов против стилей сохранён прозрачный сезонный профиль каждого клуба; блоковые метки не выдаются за предматчевые.',
            'limitation':'Блоки одного клуба и встречи между клубами зависимы. Силуэт разных единиц наблюдения нельзя считать доказательством тактической истинности.'},
        'bootstrap_stability':{'method':'60 бутстрэп-выборок матчей внутри каждого клуба; повторная кластеризация; ARI с исходными метками.',
                               'median_ari':np.median(stability),'interval_95':np.quantile(stability,[.025,.975])},
        'clusters':clusters,'limitations':[
            'Всего 20 сезонных профилей: группы описательные, не доказанные тактические типы.',
            'Сила состава, календарь и стиль смешаны; высокая устойчивость не доказывает тактическую причинность.',
            'Использован весь сезон; группы нельзя применять как известные заранее признаки исторического прогноза.',
            'Перекрывающиеся скользящие окна не объявляются независимыми наблюдениями ради увеличения выборки.']})
    with connection(readonly=False) as conn:
        put_meta(conn,'styles',result); conn.commit()
    return result


def opponent_analysis(team_id, opponent_id=None):
    from app.data import get_meta
    selected=club(team_id); df=frame(); own=df[df.team_id==team_id].copy()
    a=joblib.load(MODEL_DIR/'styles.joblib'); info=get_meta('styles')
    own['opponent_cluster']=own.opponent_id.map(a['labels'])
    groups=[]
    for c in info['clusters']:
        g=own[own.opponent_cluster==c['cluster_id']]
        groups.append({'cluster_id':c['cluster_id'],'name':c['name'],'matches':len(g),
            'points_per_match':float(g.points.mean()) if len(g) else None,
            'xg':float(g.xg.mean()) if len(g) else None,'xga':float(g.xga.mean()) if len(g) else None,
            'results':{RESULT_LABELS[k]:int((g.result==k).sum()) for k in ('W','D','L')},
            'match_ids':g.match_id.astype(int).tolist(),
            'interpretation':'Описательное сравнение; размер группы и сила соперников ограничивают вывод.'})
    target=opponent_id if opponent_id is not None else team_id; club(target)
    p=a['profiles']; x=a['scaler'].transform(p); idx=list(p.index).index(target)
    distances=np.linalg.norm(x-x[idx],axis=1); order=np.argsort(distances)
    similar=[{**club(int(p.index[i])),'distance':float(distances[i]),'cluster_id':a['labels'][int(p.index[i])]}
             for i in order if p.index[i]!=target][:4]
    context=None
    if opponent_id is not None:
        if opponent_id==team_id:
            raise ValueError('Соперник должен отличаться от выбранного клуба.')
        h=own[own.opponent_id==opponent_id]
        context={'opponent':club(opponent_id),'cluster_id':a['labels'][opponent_id],
                 'profile':p.loc[opponent_id].to_dict(),'head_to_head':h[['match_id','match_date','goals_for','goals_against','xg','xga','points']].to_dict('records')}
    visuals=style_visuals(a,team_id,opponent_id)
    if opponent_id is not None:
        visuals['coaching']=opponent_snapshot(team_id,opponent_id,df)
    return clean({'team':selected,'team_cluster':a['labels'][team_id],
        'team_profile':p.loc[team_id].to_dict(),'style_model':info,'against_styles':groups,
        'visuals':visuals,
        'similar_to':club(target),'similar_opponents':similar,'opponent_context':context})
