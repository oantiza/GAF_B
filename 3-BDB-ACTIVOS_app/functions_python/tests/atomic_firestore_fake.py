"""Small CAS-aware store for publication race and atomic rollback tests."""
from copy import deepcopy
from google.api_core.exceptions import AlreadyExists, FailedPrecondition


class Snapshot:
    def __init__(self, db, path):
        self.reference = Document(db, path)
        self.data = deepcopy(db.values.get(path))
        self.exists = path in db.values
        self.update_time = db.versions.get(path)
    def to_dict(self):
        return deepcopy(self.data)


class Document:
    def __init__(self, db, path):
        self.db, self.path = db, path
    def get(self):
        return Snapshot(self.db, self.path)
    def create(self, data):
        self.db.apply([('create', self, data, None)])
    def update(self, data, option=None):
        self.db.apply([('update', self, data, option)])
    def set(self, data):
        self.db.apply([('set', self, data, None)])
    def collection(self, name):
        return Collection(self.db, self.path + '/' + name)


class Collection:
    def __init__(self, db, path):
        self.db, self.path = db, path
    def document(self, name):
        return Document(self.db, self.path + '/' + name)
    def order_by(self, *args, **kwargs):
        return self
    def limit(self, count):
        return self
    def stream(self):
        paths = [p for p in self.db.values if p.startswith(self.path + '/')]
        return [Snapshot(self.db, p) for p in sorted(paths, key=lambda p: self.db.values[p].get('last_date', ''), reverse=True)[:1]]


class Batch:
    def __init__(self, db):
        self.db, self.ops = db, []
    def create(self, ref, data):
        self.ops.append(('create', ref, data, None))
    def set(self, ref, data):
        self.ops.append(('set', ref, data, None))
    def update(self, ref, data, option=None):
        self.ops.append(('update', ref, data, option))
    def commit(self):
        self.db.apply(self.ops)


class Database:
    def __init__(self):
        self.values, self.versions = {}, {}
    def collection(self, name):
        return Collection(self, name)
    def batch(self):
        return Batch(self)
    def apply(self, ops):
        for kind, ref, data, option in ops:
            if kind == 'create' and ref.path in self.values:
                raise AlreadyExists('exists')
            if kind == 'update' and (ref.path not in self.values or
                    (option and option._last_update_time != self.versions.get(ref.path))):
                raise FailedPrecondition('concurrent modification')
        for kind, ref, data, _ in ops:
            if kind == 'update':
                for key, value in deepcopy(data).items():
                    target = self.values[ref.path]
                    parts = key.split('.')
                    for part in parts[:-1]:
                        target = target.setdefault(part, {})
                    target[parts[-1]] = value
            else:
                self.values[ref.path] = deepcopy(data)
            self.versions[ref.path] = self.versions.get(ref.path, 0) + 1
