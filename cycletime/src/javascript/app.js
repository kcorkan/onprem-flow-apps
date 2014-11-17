Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    margin: 10,
    defaults: { margin: 5 },
    items: [
        {xtype:'container',itemId:'selector_box'},
        {xtype:'container',itemId:'display_box'},
        {xtype:'tsinfolink'}
    ],
    launch: function() {
        this._addButton(this.down('#selector_box'));
      
    },
    _addButton: function(container){
        container.add({
            xtype:'rallybutton',
            text: 'Settings',
            listeners: {
                scope: this,
                click: function(button){
                    this.setLoading("Gathering data...");
                    Ext.create('Rally.technicalservices.SettingsDialog',{
                        autoShow: true,
                        listeners: {
                            scope: this,
                            settingsChosen: function(dialog,settings) {
                                this.logger.log("Found settings: ", settings);
                                this._processWithSettings(settings);
                            }
                        }
                    });
                }
            }
        });
    },
    /*
     * expect settings to look like: 
     * {
     *      start_date: date,
     *      end_date: date,
     *      model: type path,  // TODO: change to full model
     *      state_field: field object
     * }
     */
    _processWithSettings: function(settings){
       this._getStories(settings.model, settings.state_field, settings.start_date, settings.end_date).then({
           scope: this,
           success: this._makeGrid,
           failure: function(message){
               this.down('#display_box').add({xtype:'container',html:'Problem: '+message});
           }
       });
    },
    _makeGrid: function(results){
        // expect to get back an array of hashes, where the key to each hash is a formatted id,
        // so we can just merge into a single hash
        var items = {};
        Ext.Array.each(results,function(result){
            Ext.Object.merge(items,result);
        });
        this.logger.log("Results:", items);
        var records = this._calculateCycleTime(items);
        
        this.logger.log("Ready for store:", records);
        
        var store = Ext.create('Rally.data.custom.Store',{
            data: records
        });
        
        this.down('#display_box').removeAll();
        this.down('#display_box').add({
            xtype:'rallygrid',
            store: store,
            showRowActionsColumn: false,
            columnCfgs: [
                {
                    text: 'id',
                    dataIndex:'FormattedID'
                },
                {
                    text: 'Name',
                    dataIndex:'Name',
                    flex: 1
                },
                {
                    text: 'Entry',
                    dataIndex:'__start_date',
                    flex: 1
                },
                {
                    text: 'Exit',
                    dataIndex:'__end_date',
                    flex: 1
                },
                {
                    text: 'Cycle Time (days)',
                    dataIndex:'__cycle_time'
                }
            ]
        });
        
        this.setLoading(false);
    },
    /* expecting a hash that looks like
     * {
     *     record: a data record,
     *     revisions: an array of revision records
     * }
     * 
     * want to return an array of records with calculated data
     */
    _calculateCycleTime:function(item_hashes){
        this.setLoading("Calculating cycle times...");
        this.logger.log("Calculating cycle time using:", Ext.clone(item_hashes));
        var records = [];
        
        Ext.Object.each(item_hashes, function(key,item_hash){
            var record = item_hash.record;
            var revisions = item_hash.revisions;
            // TODO: Actually parse the revisions
            var start_date = revisions[revisions.length-1].get('CreationDate');
            var end_date = revisions[0].get('CreationDate');
            this.logger.log("do math on ", start_date, end_date);
            var cycle_time = Rally.util.DateTime.getDifference(end_date, start_date, 'day');
            
            record.set("__start_date",start_date);
            record.set("__end_date", end_date);
            record.set('__cycle_time', cycle_time);
            
            records.push(record);
        },this);
        
        
        return records;
    },
    _getStories: function(model, state_field, start_date, end_date){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        this.logger.log("Getting ", model, ".", state_field, " last updated between ", start_date, " and " , end_date);
        
        var state_field_name = state_field;
        var state_field_name_alternative = state_field;
        if ( typeof(state_field) != "string" ) {
            state_field_name = state_field.get('name');
            state_field_alternative = state_field.get('value');
        }
        // for a little bit of performance help, find things that changed
        // between the begin and end dates
        var filters = [
            { property:'LastUpdateDate', operator: '>=', value: Rally.util.DateTime.toIsoString(start_date)}
        ];
        Ext.create('Rally.data.wsapi.Store', {
            model: model,
            fetch: ['RevisionHistory',state_field_name,'Revisions','FormattedID','Name','ObjectID'],
            filters: filters,
            autoLoad: true,
            listeners: {
                scope: this,
                load: function(store, records, successful) {
                    if (successful){
                        //this.logger.log("Found records:", records.length, records);
                        var promises = [];
                        Ext.Array.each(records,function(record){
                            var p = function(){
                                return me._getHistoryForRecord(record,state_field,start_date, end_date);
                            }
                            promises.push(p);
                        },this);
                        
                        //this.logger.log("Executing ", promises.length, " promises");
                        Deft.Chain.parallel(promises).then({
                            success: function(histories) {
                                deferred.resolve(histories);
                            },
                            failure: deferred.reject
                        });
                        
                    } else {
                        deferred.reject('Failed to load store for model [' + model_name + '] and fields [' + model_fields.join(',') + ']');
                    }
                }
            }
        });
        return deferred.promise;
    },
    _getHistoryForRecord: function(record,state_field,start_date, end_date) {
        var deferred = Ext.create('Deft.Deferred');
        //this.logger.log('getting history for ', record);
        
        var date_filters = Ext.create('Rally.data.wsapi.Filter',{
            property:'CreationDate',
            operator:'>=',
            value: Rally.util.DateTime.toIsoString(start_date)
        }).and(Ext.create('Rally.data.wsapi.Filter',{
            property:'CreationDate',
            operator:'<=',
            value: Rally.util.DateTime.toIsoString(Rally.util.DateTime.add(end_date,'day'))
        }));
        
        var state_field_name = state_field;
        var state_field_name_alternative = state_field;
        if ( typeof(state_field) != "string" ) {
            state_field_name = state_field.get('name');
            state_field_name_alternative = state_field.get('value');
        }
        
        // contains searches are case insensitive, so 
        // TODO: deal with possibility that the name of the field is in the description change
        //       without changing the field itself (like in the name or something)
        var state_selection_filters = Ext.create('Rally.data.wsapi.Filter',{
            property:'Description', 
            operator:'contains',
            value: Ext.util.Format.uppercase(state_field_name)
        }).or(Ext.create('Rally.data.wsapi.Filter',{
            property:'Description', 
            operator:'contains',
            value: Ext.util.Format.uppercase(state_field_name_alternative)
        }));
        
        var rev_history_filter = Ext.create('Rally.data.wsapi.Filter',{
            property:"RevisionHistory.ObjectID",
            value: record.get('RevisionHistory').ObjectID
        });
        
        var filters = rev_history_filter.and( date_filters.and(state_selection_filters) );
        // use a regular wsapi store instead of laoding the collection because I'm having
        // trouble with getting the collection to recognize the filters.
        Ext.create('Rally.data.wsapi.Store',{
            autoLoad: true,
            model:'Revision',
            filters: filters,
            fetch: ['Description','CreationDate'],
            sorters: [{property:'CreationDate',direction:'DESC'}],
            listeners: {
                scope: this,
                load: function(store,revisions){
                    //this.logger.log('revs for ', record.get('FormattedID'), ':',revisions);
                    var rev_hash = {};
                    // Only hold on to this set if there are 2 revisions (because we want to have transition
                    // into the start AND the end states
                    if ( revisions.length > 1 ) {
                        rev_hash[record.get('FormattedID')] = {record: record, revisions: revisions};
                    }
                    deferred.resolve(rev_hash);
                }
            }
        });

        return deferred.promise;        
    }
});